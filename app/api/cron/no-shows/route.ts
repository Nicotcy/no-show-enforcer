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

async function countAppointments(args: {
  clinicId: string;
  thresholdIso?: string;
  strictDetectedNull?: boolean;
}) {
  const { clinicId, thresholdIso, strictDetectedNull } = args;

  let q = supabase
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .eq("status", "scheduled");

  if (thresholdIso) {
    q = q
      .is("checked_in_at", null)
      .is("cancelled_at", null)
      .lte("starts_at", thresholdIso)
      .or("no_show_excused.is.null,no_show_excused.eq.false");
  }

  if (strictDetectedNull) {
    q = q.is("no_show_detected_at", null);
  }

  const { count, error } = await q;
  return { count: count ?? 0, error: error?.message ?? null };
}

async function sampleIds(args: {
  clinicId: string;
  thresholdIso: string;
  strictDetectedNull?: boolean;
}) {
  const { clinicId, thresholdIso, strictDetectedNull } = args;

  let q = supabase
    .from("appointments")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("status", "scheduled")
    .is("checked_in_at", null)
    .is("cancelled_at", null)
    .lte("starts_at", thresholdIso)
    .or("no_show_excused.is.null,no_show_excused.eq.false")
    .order("starts_at", { ascending: true })
    .limit(10);

  if (strictDetectedNull) {
    q = q.is("no_show_detected_at", null);
  }

  const { data, error } = await q;
  return {
    ids: (data ?? []).map((r: any) => r.id as string),
    error: error?.message ?? null,
  };
}

export async function GET(req: Request) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const debug = url.searchParams.get("debug") === "1";

    const now = new Date();

    const { data: clinics, error: clinicsError } = await supabase
      .from("clinics")
      .select("id");

    if (clinicsError) {
      return NextResponse.json(
        { step: "clinics-error", error: clinicsError.message },
        { status: 500 }
      );
    }

    let totalUpdatedCount = 0;
    const perClinic: any[] = [];

    for (const c of clinics ?? []) {
      const clinicId = c.id as string;

      // settings: grace_minutes
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

      const threshold = new Date(now.getTime() - graceMinutes * 60 * 1000);
      const thresholdIso = threshold.toISOString();

      // Debug counts (optional)
      let debugBlock: any = undefined;
      if (debug) {
        const scheduledTotal = await countAppointments({ clinicId });
        const eligibleNoDetected = await countAppointments({
          clinicId,
          thresholdIso,
          strictDetectedNull: false,
        });
        const eligibleStrict = await countAppointments({
          clinicId,
          thresholdIso,
          strictDetectedNull: true,
        });

        const sampleNoDetected = await sampleIds({
          clinicId,
          thresholdIso,
          strictDetectedNull: false,
        });
        const sampleStrict = await sampleIds({
          clinicId,
          thresholdIso,
          strictDetectedNull: true,
        });

        debugBlock = {
          graceMinutes,
          thresholdIso,
          counts: {
            scheduledTotal: scheduledTotal.count,
            eligibleNoDetected: eligibleNoDetected.count,
            eligibleStrict: eligibleStrict.count,
          },
          countErrors: {
            scheduledTotal: scheduledTotal.error,
            eligibleNoDetected: eligibleNoDetected.error,
            eligibleStrict: eligibleStrict.error,
          },
          sampleIds: {
            eligibleNoDetected: sampleNoDetected.ids,
            eligibleStrict: sampleStrict.ids,
          },
          sampleErrors: {
            eligibleNoDetected: sampleNoDetected.error,
            eligibleStrict: sampleStrict.error,
          },
        };
      }

      // Candidates (strict)
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
          error: candError.message,
          settingsStatus,
          settingsErrorMsg,
          debug: debugBlock,
        });
        continue;
      }

      const ids = (candidates ?? []).map((x: any) => x.id as string);
      const candidateCount = ids.length;

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
            candidateCount,
            updatedCount: 0,
            error: updError.message,
            settingsStatus,
            settingsErrorMsg,
            debug: debugBlock,
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
        debug: debugBlock,
      });
    }

    return NextResponse.json(
      {
        step: "done",
        now: now.toISOString(),
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
