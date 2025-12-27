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

    // 2) per clinic
    for (const c of clinics ?? []) {
      const clinicId = c.id as string;

      // ---- settings (robust, no .single()) ----
      let graceMinutes = 10; // sensible default (matches onboarding)
      let settingsStatus: "ok" | "missing" | "error" = "ok";
      let settingsErrorMsg: string | null = null;

      const { data: settingsRows, error: settingsError } = await supabase
        .from("clinic_settings")
        .select("grace_minutes")
        .eq("clinic_id", clinicId)
        .limit(1);

      if (settingsError) {
        settingsStatus = "error";
        settingsErrorMsg = settingsError.message;
        // keep default graceMinutes = 10
      } else if (settingsRows && settingsRows.length > 0) {
        const row = settingsRows[0] as any;
        if (typeof row?.grace_minutes === "number") {
          graceMinutes = row.grace_minutes;
          settingsStatus = "ok";
        } else {
          settingsStatus = "missing";
        }
      } else {
        settingsStatus = "missing";
      }

      // threshold = now - graceMinutes
    
      const threshold = new Date(now.getTime() - graceMinutes * 60 * 1000);
      // UTC "sin Z" para comparar con timestamp without time zone
      const thresholdIso = threshold.toISOString().replace(".000Z", "").replace("Z", "");


      // ---- candidates query (stronger rules) ----
      // Rules:
      // - same clinic
      // - still scheduled
      // - starts_at <= threshold
      // - NOT checked in
      // - NOT canceled (covers both canceled_at and cancelled_at)
      // - NOT excused
      const { data: candidates, error: candError } = await supabase
        .from("appointments")
        .select("id")
        .eq("clinic_id", clinicId)
        .eq("status", "scheduled")
        .is("checked_in_at", null)
        .lte("starts_at", thresholdIso)
        .is("checked_in_at", null)
        .is("canceled_at", null)
        .is("cancelled_at", null)
        .or("no_show_excused.is.null,no_show_excused.eq.false");

      if (candError) {
        // log and continue
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

      const ids = (candidates ?? []).map((x: any) => x.id as string);
      const candidateCount = ids.length;

      let clinicUpdatedCount = 0;
      let clinicUpdatedIds: string[] = [];

      // ---- update ----
      if (ids.length > 0) {
        const { data: updated, error: updError } = await supabase
          .from("appointments")
          .update({ status: "no_show", no_show_fee_charged: false })
          .in("id", ids)
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
              ids,
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
      }

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
          updatedIds: clinicUpdatedIds,
          settingsStatus,
          settingsErrorMsg,
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
        updatedIds,
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
