import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const secret = searchParams.get("secret");
  const authHeader = req.headers.get("authorization") || "";
  const expectedHeader = `Bearer ${process.env.CRON_SECRET}`;

  const secretMatch = secret && secret === process.env.CRON_SECRET;
  const headerMatch = authHeader === expectedHeader;

  if (!secretMatch && !headerMatch) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  try {
    const { data: settings, error: settingsError } = await supabase
      .from("clinic_settings")
      .select("clinic_id, grace_minutes");

    if (settingsError) {
      return NextResponse.json(
        { step: "settings-error", error: settingsError.message },
        { status: 500 }
      );
    }

    let totalCandidateCount = 0;
    let totalUpdatedCount = 0;
    const updatedIds: string[] = [];

    for (const setting of settings ?? []) {
      const clinicId = (setting as any).clinic_id as string;
      const graceMinutes = ((setting as any).grace_minutes ?? 0) as number;

      const thresholdIso = new Date(
        now.getTime() - graceMinutes * 60_000
      ).toISOString();

      const { count: candidateCount, error: countError } = await supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinicId)
        .eq("status", "scheduled")
        .eq("no_show_excused", false)
        .is("cancelled_at", null)
        .is("checked_in_at", null)
        .lt("starts_at", thresholdIso);

      if (countError) {
        return NextResponse.json(
          { step: "count-error", error: countError.message, clinicId },
          { status: 500 }
        );
      }

      const cCount = candidateCount ?? 0;
      totalCandidateCount += cCount;

      let clinicUpdatedCount = 0;
      const clinicUpdatedIds: string[] = [];

      if (cCount > 0) {
        const { data: candidates, error: fetchError } = await supabase
          .from("appointments")
          .select("id")
          .eq("clinic_id", clinicId)
          .eq("status", "scheduled")
          .eq("no_show_excused", false)
          .is("cancelled_at", null)
          .is("checked_in_at", null)
          .lt("starts_at", thresholdIso);

        if (fetchError) {
          return NextResponse.json(
            { step: "fetch-error", error: fetchError.message, clinicId },
            { status: 500 }
          );
        }

        const ids = (candidates ?? []).map((r: any) => r.id as string);

        const { error: updateError } = await supabase
          .from("appointments")
          .update({ status: "no_show", no_show_fee_charged: false })
          .in("id", ids);

        if (updateError) {
          return NextResponse.json(
            { step: "update-error", error: updateError.message, clinicId },
            { status: 500 }
          );
        }

        clinicUpdatedCount = ids.length;
        clinicUpdatedIds.push(...ids);

        totalUpdatedCount += ids.length;
        updatedIds.push(...ids);
      }

      const { error: logError } = await supabase.from("cron_runs").insert({
        clinic_id: clinicId,
        job: "no_shows",
        candidate_count: cCount,
        updated_count: clinicUpdatedCount,
        details: {
          thresholdIso,
          graceMinutes,
          updatedIds: clinicUpdatedIds,
        },
      });

      // No rompemos el cron por un fallo de logging, pero lo dejamos trazable en logs de Vercel
      if (logError) {
        console.error("cron_runs insert error", { clinicId, logError });
      }
    }

    return NextResponse.json(
      {
        step: "done",
        now: now.toISOString(),
        candidateCount: totalCandidateCount,
        updatedCount: totalUpdatedCount,
        updatedIds,
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { step: "crash", error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
