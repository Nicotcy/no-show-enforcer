import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } }
);

function isAuthorized(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  const authHeader = req.headers.get("authorization") || "";
  const expectedHeader = `Bearer ${process.env.CRON_SECRET}`;

  return (
    (secret && secret === process.env.CRON_SECRET) ||
    authHeader === expectedHeader
  );
}

function clampInt(n: unknown, min: number, max: number, fallback: number) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(x)));
}

export async function GET(req: Request) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const now = new Date();

    // Only process clinics that have settings (active clinics)
    const { data: settingsClinics, error: settingsClinicsError } = await supabase
      .from("clinic_settings")
      .select("clinic_id, grace_minutes");

    if (settingsClinicsError) {
      return NextResponse.json(
        { step: "settings-clinics-error", error: settingsClinicsError.message },
        { status: 500 }
      );
    }

    let totalCandidateCount = 0;
    let totalUpdatedCount = 0;
    const perClinic: any[] = [];

    for (const row of settingsClinics ?? []) {
      const clinicId = (row as any).clinic_id as string;
      const graceMinutes = clampInt((row as any).grace_minutes, 0, 240, 10);

      const threshold = new Date(now.getTime() - graceMinutes * 60 * 1000);
      const thresholdIso = threshold.toISOString();

      // Candidates (strict + idempotent)
      const { data: candidates, error: candError } = await supabase
        .from("appointments")
        .select("id")
        .eq("clinic_id", clinicId)
        .eq("status", "scheduled")
        .is("checked_in_at", null)
        .is("cancelled_at", null)
        .is("no_show_detected_at", null)
        .lte("starts_at", thresholdIso)
        .or("no_show_excused.is.null,no_show_excused.eq.false");

      if (candError) {
        perClinic.push({
          clinicId,
          graceMinutes,
          thresholdIso,
          candidateCount: 0,
          updatedCount: 0,
          error: candError.message,
        });
        continue;
      }

      const ids = (candidates ?? []).map((x: any) => x.id as string);
      const candidateCount = ids.length;
      totalCandidateCount += candidateCount;

      let updatedCount = 0;

      if (ids.length > 0) {
        const { data: updated, error: updError } = await supabase
          .from("appointments")
          .update({
            status: "no_show",
            no_show_fee_charged: false,
            no_show_detected_at: now.toISOString(),
          })
          .in("id", ids)
          .select("id");

        if (updError) {
          perClinic.push({
            clinicId,
            graceMinutes,
            thresholdIso,
            candidateCount,
            updatedCount: 0,
            error: updError.message,
          });
          continue;
        }

        updatedCount = (updated ?? []).length;
        totalUpdatedCount += updatedCount;
      }

      perClinic.push({
        clinicId,
        graceMinutes,
        thresholdIso,
        candidateCount,
        updatedCount,
      });
    }

    return NextResponse.json(
      {
        step: "done",
        now: now.toISOString(),
        candidateCount: totalCandidateCount,
        updatedCount: totalUpdatedCount,
        perClinic,
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { step: "catch", error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
