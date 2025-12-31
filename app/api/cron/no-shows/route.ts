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

    // 1) clinics
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
    const updatedIds: string[] = [];
    const perClinic: any[] = [];

    for (const c of clinics ?? []) {
      const clinicId = c.id as string;

      // ---- settings (robust) ----
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
      } else if (settingsRow && typeof (settingsRow as any)?.grace_minutes !== "undefined") {
        graceMinutes = clampInt((settingsRow as any).grace_minutes, 0, 240, 10);
      } else {
        settingsStatus = "missing";
      }

      // threshold = now - graceMinutes
      const threshold = new Date(now.getTime() - graceMinutes * 60 * 1000);

      // Use full ISO (with Z). This is safest for timestamptz columns.
      const thresholdIso = threshold.toISOString();

      // ---- candidates query (ONLY count + ids for response) ----
      // We keep this select for observability, but LIMIT it so we don't return huge arrays.
      const { data: candidates, error: candError } = await supabase
        .from("appointments")
        .select("id")
        .eq("clinic_id", clinicId)
        .eq("status", "scheduled")
        .is("checked_in_at", null)
        .lte("starts_at", thresholdIso)
        .is("cancelled_at", null)
        .is("canceled_at", null)
        .or("no_show_excused.is.null,no_show_excused.eq.false")
        .limit(500); // avoid huge payloads in case someone imported tons of appointments

      if (candError) {
        await supabase.from("cron_runs").insert({
          clinic_id: clinicId,
          job: "no-shows",
          candidate_count: 0,
          updated_count: 0,
          details: {
            ok: false,
            step: "candidates-error",
            error: candError.message,
            now: now.toISOString(),
            graceMinutes,
            thresholdIso,
            settingsStatus,
            settingsErrorMsg,
          },
        });

        perClinic.push({
          clinicId,
          candidateCount: 0,
          updatedCount: 0,
          error: candError.message,
        });
        continue;
      }

      const candidateIds = (candidates ?? []).map((x: any) => x.id as string);
      const candidateCount = candidateIds.length;

      // ---- update by FILTER (idempotent + no in(ids)) ----
      // Important: include status=scheduled again in update filter so we don't rewrite rows that changed meanwhile.
      let clinicUpdatedCount = 0;
      let clinicUpdatedIds: string[] = [];

      const { data: updated, error: updError } = await supabase
        .from("appointments")
        .update({ status: "no_show", no_show_fee_charged: false })
        .eq("clinic_id", clinicId)
        .eq("status", "scheduled")
        .is("checked_in_at", null)
        .lte("starts_at", thresholdIso)
        .is("cancelled_at", null)
        .is("canceled_at", null)
        .or("no_show_excused.is.null,no_show_excused.eq.false")
        .select("id");

      if (updError) {
        await supabase.from("cron_runs").insert({
          clinic_id: clinicId,
          job: "no-shows",
          candidate_count: candidateCount,
          updated_count: 0,
          details: {
            ok: false,
            step: "update-error",
            error: updError.message,
            now: now.toISOString(),
            graceMinutes,
            thresholdIso,
            // return only sampled ids
            sampleCandidateIds: candidateIds,
            settingsStatus,
            settingsErrorMsg,
          },
        });

        perClinic.push({
          clinicId,
          candidateCount,
          updatedCount: 0,
          error: updError.message,
        });
        continue;
      }

      clinicUpdatedIds = (updated ?? []).map((u: any) => u.id as string);
      clinicUpdatedCount = clinicUpdatedIds.length;

      // ---- logging ----
      const { error: logError } = await supabase.from("cron_runs").insert({
        clinic_id: clinicId,
        job: "no-shows",
        candidate_count: candidateCount,
        updated_count: clinicUpdatedCount,
        details: {
          ok: true,
          now: now.toISOString(),
          graceMinutes,
          thresholdIso,
          updatedIds: clinicUpdatedIds.slice(0, 500),
          settingsStatus,
          settingsErrorMsg,
          note:
            candidateCount >= 500
              ? "Candidate list truncated to 500 for response/log; update still applied to all matches."
              : null,
        },
      });

      totalCandidateCount += candidateCount;
      totalUpdatedCount += clinicUpdatedCount;
      updatedIds.push(...clinicUpdatedIds);

      perClinic.push({
        clinicId,
        candidateCount,
        updatedCount: clinicUpdatedCount,
        logError: logError ? logError.message : null,
      });
    }

    return NextResponse.json(
      {
        step: "done",
        now: now.toISOString(),
        candidateCount: totalCandidateCount,
        updatedCount: totalUpdatedCount,
        updatedIds: updatedIds.slice(0, 1000),
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
