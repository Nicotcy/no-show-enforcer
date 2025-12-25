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
    l
    for (const setting of settings ?? []) {
      const graceMinutes = (setting as any).grace_minutes ?? 0;
      const clinicId = (setting as any).clinic_id;
      const threshold = new Date(
        now.getTime() - graceMinutes * 60000
      ).toISOString();

      const { count: candidateCount, error: countError } = await supabase
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("clinic_id", clinicId)
        .eq("status", "scheduled")
        .eq("no_show_excused", false)
        .lt("starts_at", threshold);
      if (countError) {
        return NextResponse.json(
          { step: "count-error", error: countError.message },
          { status: 500 }
        );
      }
      totalCandidateCount += candidateCount ?? 0;

      if ((candidateCount ?? 0) > 0) {
        const { data: candidates, error: fetchError } = await supabase
          .from("appointments")
          .select("id")
          .eq("clinic_id", clinicId)
          .eq("status", "scheduled")
          .eq("no_show_excused", false)
          .lt("starts_at", threshold);
        if (fetchError) {
          return NextResponse.json(
            { step: "fetch-error", error: fetchError.message },
            { status: 500 }
          );
        }
        const ids = candidates!.map((r: any) => r.id);
        const { error: updateError } = await supabase
          .from("appointments")
          .update({ status: "no_show", no_show_fee_charged: false })
          .in("id", ids);
        if (updateError) {
          return NextResponse.json(
            { step: "update-error", error: updateError.message },
            { status: 500 }
          );
        }
        totalUpdatedCount += ids.length;
        updatedIds.push(...ids);
      }
    }
et totalUpdatedCount = 0;
    let updatedIds: string[] = [];


    return NextResponse.json({ step: "done", candidateCount: totalCandidateCount, updatedCount: totalUpdatedCount, updatedIds }, { status: 200 });
} catch (error) {
  return NextResponse.json({ step: "crash", error: (error as any).message }, { status: 500 });
}
