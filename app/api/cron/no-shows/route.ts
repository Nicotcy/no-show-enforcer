import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

/**
 * Service-role Supabase client
 */
const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } }
);

/**
 * Auth: secret via query param OR Authorization header
 */
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

    /**
     * 1) Load all clinics
     */
    const { data: clinics, error: clinicsError } = await supabase
      .from("clinics")
      .select("id");

    if (clinicsError) {
      return NextResponse.json(
        { step: "clinics-error", error: clinicsError.message },
        { status: 500 }
      );
    }

    let totalCandidateCount = 0;
    let totalUpdatedCount = 0;
    const perClinic: any[] = [];

    /**
     * 2) Process per clinic
     */
    for (const c of clinics ?? []) {
      const clinicId = c.id as string;

      /**
       * 2.a) Load grace_minutes
       */
      let graceMinutes = 10;
      let settingsStatus: "ok" | "missing" | "error" = "ok";
      let settingsErrorMsg: string | null = null;

      const { data: settingsRow, error: settingsError } = await supabase
        .from("clinic_settings")
        .select("grace_minutes")
        .eq("clinic_id", clinicId)
        .maybeSingle();

      if (settingsError) {
        settingsStatus = "error";
        settingsErrorMsg = settingsError.message;
      } else if (settingsRow?.grace_minutes !== undefined) {
        graceMinutes = clampInt(settingsRow.grace_minutes, 0, 240, 10);
      } else {
        settingsStatus = "missing";
      }

      /**
       * Threshold = now - graceMinutes
       * starts_at is timestamptz, so ISO with Z is correct
       */
      const threshold = new Date(now.getTime() - graceMinutes * 60 * 1000);
      const thresholdIso = threshold.toISOString();

      /**
       * 2.b) Find candidates (read-only)
       */
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
          candidateCount: 0,
          updatedCount: 0,
          error: candError.message,
          settingsStatus,
          settingsErrorMsg,
        });
        continue;
      }

      const candidateCount = (candidates ?? []).length;
      totalCandidateCount += candidateCount;

      /**
       * 2.c) Idempotent update
       */
      let updatedCount = 0;

      if (candidateCount > 0) {
        const { data: updated, error: updError } = await supabase
          .from("appointments")
          .update({
            status: "no_show",
            no_show_fee_charged: false,
            no_show_detected_at: now.toISOString(),
          })
          .eq("clinic_id", clinicId)
          .eq("status", "scheduled")
          .is("checked_in_at", null)
          .is("cancelled_at", null)
          .is("no_show_detected_at", null)
          .lte("starts_at", thresholdIso)
          .or("no_show_excused.is.null,no_show_excused.eq.false")
          .select("id");

        if (updError) {
          perClinic.push({
            clinicId,
            candidateCount,
            updatedCount: 0,
            error: updError.message,
            settingsStatus,
            settingsErrorMsg,
          });
          continue;
        }

        updatedCount = (updated ?? []).length;
        totalUpdatedCount += updatedCount;
      }

      perClinic.push({
        clinicId,
        candidateCount,
        updatedCount,
        settingsStatus,
        settingsErrorMsg,
      });
    }

    /**
     * 3) Final response
     */
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
