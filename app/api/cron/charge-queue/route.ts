import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getSupabaseUrl() {
  // Preferimos SUPABASE_URL, pero si está vacío, caemos a NEXT_PUBLIC_SUPABASE_URL
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  return url;
}

function getProjectRef(url: string) {
  // https://xxxx.supabase.co -> "xxxx"
  try {
    const u = new URL(url);
    const host = u.hostname; // xxxx.supabase.co
    return host.split(".")[0] || null;
  } catch {
    return null;
  }
}

const supabaseUrl = getSupabaseUrl();
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const supabase = createClient(supabaseUrl, supabaseKey, {
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

const BATCH_SIZE = 100;

export async function GET(req: Request) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!supabaseUrl) {
      return NextResponse.json(
        { error: "Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL" },
        { status: 500 }
      );
    }
    if (!supabaseKey) {
      return NextResponse.json(
        { error: "Missing SUPABASE_SERVICE_ROLE_KEY" },
        { status: 500 }
      );
    }

    const nowIso = new Date().toISOString();
    const supabaseProjectRef = getProjectRef(supabaseUrl);

    // 1) candidatos: pending && !charged && status=no_show && (excused null/false) && processing_at IS NULL
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
        {
          step: "candidates-error",
          error: candError.message,
          supabaseProjectRef,
          supabaseUrlUsed: supabaseUrl,
        },
        { status: 500 }
      );
    }

    const candidateIds = (candidates ?? []).map((c: any) => String(c.id));
    const clinicIds = Array.from(
      new Set((candidates ?? []).map((c: any) => String(c.clinic_id)))
    );

    if (candidateIds.length === 0) {
      return NextResponse.json(
        {
          step: "done",
          now: nowIso,
          candidateCount: 0,
          eligibleCount: 0,
          queuedCount: 0,
          supabaseProjectRef,
          supabaseUrlUsed: supabaseUrl,
        },
        { status: 200 }
      );
    }

    // 2) seguridad extra: settings actuales
    const { data: settingsRows, error: settingsError } = await supabase
      .from("clinic_settings")
      .select("clinic_id, auto_charge_enabled, no_show_fee_cents")
      .in("clinic_id", clinicIds);

    if (settingsError) {
      return NextResponse.json(
        {
          step: "settings-error",
          error: settingsError.message,
          supabaseProjectRef,
          supabaseUrlUsed: supabaseUrl,
        },
        { status: 500 }
      );
    }

    const settingsMap = new Map<string, { auto: boolean; fee: number }>();
    for (const r of settingsRows ?? []) {
      settingsMap.set(String((r as any).clinic_id), {
        auto: Boolean((r as any).auto_charge_enabled),
        fee:
          typeof (r as any).no_show_fee_cents === "number"
            ? (r as any).no_show_fee_cents
            : 0,
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
          note: "No eligible rows after checking clinic_settings.",
          supabaseProjectRef,
          supabaseUrlUsed: supabaseUrl,
        },
        { status: 200 }
      );
    }

    // 3) lock
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
        {
          step: "lock-error",
          error: lockError.message,
          supabaseProjectRef,
          supabaseUrlUsed: supabaseUrl,
        },
        { status: 500 }
      );
    }

    const lockedIds = (locked ?? []).map((x: any) => String(x.id));

    return NextResponse.json(
      {
        step: "done",
        now: nowIso,
        candidateCount: candidateIds.length,
        eligibleCount: eligibleIds.length,
        queuedCount: lockedIds.length,
        queuedIds: lockedIds,
        supabaseProjectRef,
        supabaseUrlUsed: supabaseUrl,
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
