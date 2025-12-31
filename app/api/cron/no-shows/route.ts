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

async function countQuery(q: any) {
  // Supabase count without fetching rows
  const { count, error } = await q.select("id", { count: "exact", head: true });
  if (error) return { count: 0, error: error.message };
  return { count: count ?? 0, error: null };
}

export async function GET(req: Request) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const debug = url.searchParams.get("debug") === "1";

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

      // Base filters (the ones that should always apply)
      const base = supabase
        .from("appointments")
        .eq("clinic_id", clinicId)
        .eq("status", "scheduled")
        .is("checked_in_at", null)
        .is("cancelled_at", null)
        .lte("starts_at", thresholdIso)
        .or("no_show_excused.is.null,no_show_excused.eq.false");

      // Counts for debug
      let scheduledCount = null;
      let eligibleNoDetectedCount = null;
      let eligibleStrictCount = null;
      let debugSampleIdsNoDetected: string[] | null = null;
      let debugSampleIdsStrict: string[] | null = null;
      let debugCountErrors: any = null;

      if (debug) {
        // scheduled total for clinic (independent of time)
        const scheduledTotal = await countQuery(
          supabase
            .from("appointments")
            .eq("clinic_id", clinicId)
            .eq("status", "scheduled")
        );

        // eligible without no_show_detected_at filter
        const eligibleNoDetected = await countQuery(
          supabase.from("appointments").match({
            clinic_id: clinicId,
            status: "scheduled",
          })
            .is("checked_in_at", null)
            .is("cancelled_at", null)
            .lte("starts_at", thresholdIso)
            .or("no_show_excused.is.null,no_show_excused.eq.false")
        );

        // eligible with no_show_detected_at IS NULL (strict)
        const eligibleStrict = await countQuery(
          supabase.from("appointments").match({
            clinic_id: clinicId,
            status: "scheduled",
          })
            .is("checked_in_at", null)
            .is("cancelled_at", null)
            .is("no_show_detected_at", null)
            .lte("starts_at", thresholdIso)
            .or("no_show_excused.is.null,no_show_excused.eq.false")
        );

        scheduledCount = scheduledTotal.count;
        eligibleNoDetectedCount = eligibleNoDetected.count;
        eligibleStrictCount = eligibleStrict.count;

        debugCountErrors = {
          scheduledTotalError: scheduledTotal.error,
          eligibleNoDetectedError: eligibleNoDetected.error,
          eligibleStrictError: eligibleStrict.error,
        };

        // Sample IDs
        const { data: sample1 } = await supabase
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

        debugSampleIdsNoDetected = (sample1 ?? []).map((r: any) => r.id as string);

        const { data: sample2 } = await supabase
          .from("appointments")
          .select("id")
          .eq("clinic_id", clinicId)
          .eq("status", "scheduled")
          .is("checked_in_at", null)
          .is("cancelled_at", null)
          .is("no_show_detected_at", null)
          .lte("starts_at", thresholdIso)
          .or("no_show_excused.is.null,no_show_excused.eq.false")
          .order("starts_at", { ascending: true })
          .limit(10);

        debugSampleIdsStrict = (sample2 ?? []).map((r: any) => r.id as string);
      }

      // Candidates (strict) - what we really use to update
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
          graceMinutes,
          thresholdIso,
          debug: debug
            ? {
                scheduledCount,
                eligibleNoDetectedCount,
                eligibleStrictCount,
                debugCountErrors,
                debugSampleIdsNoDetected,
                debugSampleIdsStrict,
              }
            : undefined,
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
            graceMinutes,
            thresholdIso,
            debug: debug
              ? {
                  scheduledCount,
                  eligibleNoDetectedCount,
                  eligibleStrictCount,
                  debugCountErrors,
                  debugSampleIdsNoDetected,
                  debugSampleIdsStrict,
                }
              : undefined,
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
        graceMinutes,
        thresholdIso,
        debug: debug
          ? {
              scheduledCount,
              eligibleNoDetectedCount,
              eligibleStrictCount,
              debugCountErrors,
              debugSampleIdsNoDetected,
              debugSampleIdsStrict,
            }
          : undefined,
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
