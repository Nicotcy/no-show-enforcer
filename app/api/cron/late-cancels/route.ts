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

const BATCH_SIZE = 200;

// Late-cancel si:
// - status = canceled
// - cancelled_at existe
// - cancelled_at < starts_at
// - (starts_at - cancelled_at) <= late_cancel_window_minutes de la clínica
// - late_cancel_detected_at IS NULL (idempotencia)
export async function GET(req: Request) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const nowIso = new Date().toISOString();

    // 1) Traer candidatos "canceled" sin detectar aún
    const { data: candidates, error: candError } = await supabase
      .from("appointments")
      .select("id, clinic_id, starts_at, cancelled_at, status, late_cancel_detected_at")
      .eq("status", "canceled")
      .not("cancelled_at", "is", null)
      .is("late_cancel_detected_at", null)
      .limit(BATCH_SIZE);

    if (candError) {
      return NextResponse.json({ error: candError.message }, { status: 500 });
    }

    if (!candidates || candidates.length === 0) {
      return NextResponse.json(
        { ok: true, candidateCount: 0, updatedCount: 0 },
        { status: 200 }
      );
    }

    const clinicIds = Array.from(
      new Set(candidates.map((c: any) => String(c.clinic_id)))
    );

    // 2) Cargar settings de ventana late-cancel por clínica
    const { data: settingsRows, error: settingsError } = await supabase
      .from("clinic_settings")
      .select("clinic_id, late_cancel_window_minutes")
      .in("clinic_id", clinicIds);

    if (settingsError) {
      return NextResponse.json({ error: settingsError.message }, { status: 500 });
    }

    const windowMap = new Map<string, number>();
    for (const r of settingsRows ?? []) {
      const minutes =
        typeof (r as any).late_cancel_window_minutes === "number"
          ? (r as any).late_cancel_window_minutes
          : 0;
      windowMap.set(String((r as any).clinic_id), minutes);
    }

    // 3) Filtrar en Node (simple y seguro)
    const lateCancelIds: string[] = [];

    for (const a of candidates as any[]) {
      const clinicId = String(a.clinic_id);
      const windowMin = windowMap.get(clinicId) ?? 0;
      if (windowMin <= 0) continue;

      const startsAt = new Date(a.starts_at).getTime();
      const cancelledAt = new Date(a.cancelled_at).getTime();

      // cancel debe ocurrir antes del inicio
      if (!(cancelledAt < startsAt)) continue;

      const diffMinutes = (startsAt - cancelledAt) / (60 * 1000);
      if (diffMinutes <= windowMin) {
        lateCancelIds.push(String(a.id));
      }
    }

    if (lateCancelIds.length === 0) {
      return NextResponse.json(
        { ok: true, candidateCount: candidates.length, updatedCount: 0 },
        { status: 200 }
      );
    }

    // 4) Marcar late_cancel_detected_at (idempotente)
    const { error: updError } = await supabase
      .from("appointments")
      .update({ late_cancel_detected_at: nowIso })
      .in("id", lateCancelIds);

    if (updError) {
      return NextResponse.json({ error: updError.message }, { status: 500 });
    }

    // 5) Log best-effort
    await supabase.from("cron_runs").insert({
      clinic_id: null,
      job: "late-cancels",
      candidate_count: candidates.length,
      updated_count: lateCancelIds.length,
      details: { at: nowIso },
    });

    return NextResponse.json(
      { ok: true, candidateCount: candidates.length, updatedCount: lateCancelIds.length },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unexpected error" },
      { status: 500 }
    );
  }
}
