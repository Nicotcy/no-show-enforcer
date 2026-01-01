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

const BATCH_SIZE = 100;

export async function GET(req: Request) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const nowIso = new Date().toISOString();

    // 1) Candidatos simples y robustos:
    // pending=true && charged=false && status=no_show && (excused null/false) && processing_at IS NULL
    const { data: candidates, error: candError } = await supabase
      .from("appointments")
      .select("id, clinic_id")
      .eq("no_show_fee_pending", true)
      .eq("no_show_fee_charged", false)
      .eq("status", "no_show")
      .or("no_show_excused.is.null,no_show_excused.eq.false")
      .is("no_show_fee_processing_at", null)
      .limit(BATCH_SIZE);

    if (candError) {
      return NextResponse.json(
        { step: "candidates-error", error: candError.message },
        { status: 500 }
      );
    }

    const candidateIds = (candidates ?? []).map((c: any) => c.id as string);
    const clinicIds = Array.from(
      new Set((candidates ?? []).map((c: any) => c.clinic_id as string))
    );

    if (candidateIds.length === 0) {
      return NextResponse.json(
        { step: "done", now: nowIso, candidateCount: 0, eligibleCount: 0, queuedCount: 0 },
        { status: 200 }
      );
    }

    // 2) Seguridad extra: si la clínica ha cambiado settings (auto_charge off o fee 0), no encolamos
    const { data: settingsRows, error: settingsError } = await supabase
      .from("clinic_settings")
      .select("clinic_id, auto_charge_enabled, no_show_fee_cents")
      .in("clinic_id", clinicIds);

    if (settingsError) {
      return NextResponse.json(
        { step: "settings-error", error: settingsError.message },
        { status: 500 }
      );
    }

    const settingsMap = new Map<string, { auto: boolean; fee: number }>();
    for (const r of settingsRows ?? []) {
      settingsMap.set(String((r as any).clinic_id), {
        auto: Boolean((r as any).auto_charge_enabled),
        fee: typeof (r as any).no_show_fee_cents === "number" ? (r as any).no_show_fee_cents : 0,
      });
    }

    const eligibleIds: string[] = [];
    for (const c of candidates ?? []) {
      const clinicId = String((c as any).clinic_id);
      const s = settingsMap.get(clinicId);
      if (s && s.auto && s.fee > 0) eligibleIds.push(String((c as any).id));
    }

    if (eligibleIds.length === 0) {
      return NextResponse.json(
        {
          step: "done",
          now: nowIso,
          candidateCount: candidateIds.length,
          eligibleCount: 0,
          queuedCount: 0,
          note: "No eligible rows after checking clinic_settings (auto_charge_enabled/fee).",
        },
        { status: 200 }
      );
    }

    // 3) Lock: marcamos processing_at + last_attempt_at
    const { data: locked, error: lockError } = await supabase
      .from("appointments")
      .update({
        no_show_fee_processing_at: nowIso,
        no_show_fee_last_attempt_at: nowIso,
      })
      .in("id", eligibleIds)
      .select("id");

    if (lockError) {
      return NextResponse.json(
        { step: "lock-error", error: lockError.message },
        { status: 500 }
      );
    }

    const lockedIds = (locked ?? []).map((x: any) => x.id as string);

    // 4) Intento de log (si falla, NO rompemos el job)
    const { error: logError } = await supabase.from("cron_runs").insert({
      clinic_id: null,
      job: "charge-queue",
      candidate_count: candidateIds.length,
      updated_count: lockedIds.length,
      details: {
        ok: true,
        now: nowIso,
        batchSize: BATCH_SIZE,
        eligibleIds,
        lockedIds,
      },
    });

    return NextResponse.json(
      {
        step: "done",
        now: nowIso,
        candidateCount: candidateIds.length,
        eligibleCount: eligibleIds.length,
        queuedCount: lockedIds.length,
        queuedIds: lockedIds,
        logError: logError ? logError.message : null,
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
