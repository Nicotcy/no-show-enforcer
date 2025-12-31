import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabaseUrl = process.env.SUPABASE_URL as string;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

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

function supabaseHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
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

    // ---------- PREFLIGHT via RPC ----------
    const { data: schemaInfo, error: schemaErr } = await supabase.rpc(
      "debug_appointments_schema"
    );

    if (schemaErr) {
      return NextResponse.json(
        {
          step: "preflight-rpc-error",
          error: schemaErr.message,
          supabaseHost: supabaseHost(supabaseUrl),
          fix:
            "Run the SQL to create public.debug_appointments_schema() in this Supabase project.",
        },
        { status: 500 }
      );
    }

    const hasNoShowExcused = Boolean((schemaInfo as any)?.has_no_show_excused);
    if (!hasNoShowExcused) {
      return NextResponse.json(
        {
          step: "preflight-missing-column",
          error:
            "public.appointments.no_show_excused is missing in the DB this deployment is using.",
          supabaseHost: supabaseHost(supabaseUrl),
          schemaInfo,
          fix:
            "Run ALTER TABLE on the Supabase project that matches this supabaseHost (Vercel env may point to a different project).",
        },
        { status: 500 }
      );
    }
    // ---------- END PREFLIGHT ----------

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

      // ---- settings ----
      let graceMinutes = 10;
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
      } else if (settingsRows && settingsRows.length > 0) {
        const row = settingsRows[0] as any;
        graceMinutes = clampInt(row?.grace_minutes, 0, 240, 10);
      } else {
        settingsStatus = "missing";
      }

      const threshold = new Date(now.getTime() - graceMinutes * 60 * 1000);

      // Your DB column starts_at is timestamp without time zone.
      // You’ve been inserting "UTC without Z", so keep the cron consistent with that for now.
      const thresholdIso = threshold
        .toISOString()
        .replace(".000Z", "")
        .replace("Z", "");

      // ---- candidates ----
      const { data: candidates, error: candError } = await supabase
        .from("appointments")
        .select("id")
        .eq("clinic_id", clinicId)
        .eq("status", "scheduled")
        .is("checked_in_at", null)
        .lte("starts_at", thresholdIso)
        .is("canceled_at", null)
        .is("cancelled_at", null)
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

        clinicUpdatedIds = (updated ?? []).map((u: any) => u.id as string);
        clinicUpdatedCount = clinicUpdatedIds.length;
      }

      totalCandidateCount += candidateCount;
      totalUpdatedCount += clinicUpdatedCount;
      updatedIds.push(...clinicUpdatedIds);

      perClinic.push({
        clinicId,
        candidateCount,
        updatedCount: clinicUpdatedCount,
        settingsStatus,
        settingsErrorMsg,
      });
    }

    return NextResponse.json(
      {
        step: "done",
        now: now.toISOString(),
        supabaseHost: supabaseHost(supabaseUrl),
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
