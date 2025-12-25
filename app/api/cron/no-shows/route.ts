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

    // 1) traemos clínicas
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

    // 2) procesamos cada clínica
    for (const c of clinics ?? []) {
      const clinicId = c.id as string;

      // settings (si falla, usamos defaults)
      let graceMinutes = 0;
      let settingsStatus: "ok" | "missing" | "error" = "ok";
      let settingsErrorMsg: string | null = null;

      const { data: settings, error: settingsError } = await supabase
        .from("clinic_settings")
        .select("grace_minutes")
        .eq("clinic_id", clinicId)
        .single();

      if (settingsError) {
        // Si no existe fila de settings o hay error, seguimos con graceMinutes=0
        settingsStatus = "error";
        settingsErrorMsg = settingsError.message;
      } else if (settings && typeof settings.grace_minutes === "number") {
        graceMinutes = settings.grace_minutes;
      } else {
        settingsStatus = "missing";
      }

      const threshold = new Date(now.getTime() - graceMinutes * 60 * 1000);
      const thresholdIso = threshold.toISOString();

      // 3) candidatos: citas pasadas + gracia, aún scheduled
      const { data: candidates, error: candError } = await supabase
        .from("appointments")
        .select("id")
        .eq("clinic_id", clinicId)
        .eq("status", "scheduled")
        .lte("starts_at", thresholdIso)
        .or("no_show_excused.is.null,no_show_excused.eq.false");

      if (candError) {
        // registramos run aunque falle el query de candidatos
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

      // 4) logging a cron_runs (si esto falla, no tiramos el cron)
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

      // acumulamos totales
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
