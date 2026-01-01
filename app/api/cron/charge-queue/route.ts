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
  const authHeader = req.headersget?.("authorization") || "";
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

    // 1) Candidatos: pendientes de cobro, no charged, no excused, sin lock
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
        { error: candError.message },
        { status: 500 }
      );
    }

    if (!candidates || candidates.length === 0) {
      return NextResponse.json(
        { ok: true, candidateCount: 0, queuedCount: 0 },
        { status: 200 }
      );
    }

    const candidateIds = candidates.map((c: any) => c.id);
    const clinicIds = Array.from(
      new Set(candidates.map((c: any) => c.clinic_id))
    );

    // 2) Revalidar settings actuales por clínica
    const { data: settingsRows, error: settingsError } = await supabase
      .from("clinic_settings")
      .select("clinic_id, auto_charge_enabled, no_show_fee_cents")
      .in("clinic_id", clinicIds);

    if (settingsError) {
      return NextResponse.json(
        { error: settingsError.message },
        { status: 500 }
      );
    }

    const settingsMap = new Map<string, { auto: boolean; fee: number }>();
    for (const r of settingsRows ?? []) {
      settingsMap.set(r.clinic_id, {
        auto: Boolean(r.auto_charge_enabled),
        fee: typeof r.no_show_fee_cents === "number" ? r.no_show_fee_cents : 0,
      });
    }

    const eligibleIds: string[] = [];
    for (const c of candidates) {
      const s = settingsMap.get(c.clinic_id);
      if (s && s.auto && s.fee > 0) eligibleIds.push(c.id);
    }

    if (eligibleIds.length === 0) {
      return NextResponse.json(
        { ok: true, candidateCount: candidateIds.length, queuedCount: 0 },
        { status: 200 }
      );
    }

    // 3) Lock: reservar para cobro
    const { error: lockError } = await supabase
      .from("appointments")
      .update({
        no_show_fee_processing_at: nowIso,
        no_show_fee_last_attempt_at: nowIso,
      })
      .in("id", eligibleIds);

    if (lockError) {
      return NextResponse.json(
        { error: lockError.message },
        { status: 500 }
      );
    }

    // 4) Log opcional (best-effort)
    await supabase.from("cron_runs").insert({
      clinic_id: null,
      job: "charge-queue",
      candidate_count: candidateIds.length,
      updated_count: eligibleIds.length,
      details: {
        at: nowIso,
        queuedCount: eligibleIds.length,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        candidateCount: candidateIds.length,
        queuedCount: eligibleIds.length,
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unexpected error" },
      { status: 500 }
    );
  }
}
