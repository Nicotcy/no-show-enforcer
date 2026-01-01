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
const MAX_ATTEMPTS = 3;

// Fallo determinista ~20% según el último hex del UUID.
// (sirve para testear retries sin "azar" raro)
function shouldFailDeterministically(id: string) {
  const last = id.trim().slice(-1).toLowerCase();
  const n = parseInt(last, 16);
  if (Number.isNaN(n)) return false;
  return n % 5 === 0; // 0,5,a,f -> 4/16 = 25% aprox (suficientemente parecido)
}

export async function GET(req: Request) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const nowIso = new Date().toISOString();

    // 1) Filas lockeadas y pendientes (solo esas)
    const { data: rows, error: fetchError } = await supabase
      .from("appointments")
      .select("id, no_show_fee_attempt_count")
      .eq("status", "no_show")
      .eq("no_show_fee_pending", true)
      .eq("no_show_fee_charged", false)
      .not("no_show_fee_processing_at", "is", null)
      .limit(BATCH_SIZE);

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    if (!rows || rows.length === 0) {
      return NextResponse.json(
        { ok: true, processedCount: 0, successCount: 0, failedCount: 0 },
        { status: 200 }
      );
    }

    let successCount = 0;
    let failedCount = 0;

    // 2) Procesar uno a uno: así no mezclamos éxitos y fallos en un update masivo
    for (const r of rows as any[]) {
      const id = String(r.id);
      const prevAttempts =
        typeof r.no_show_fee_attempt_count === "number"
          ? r.no_show_fee_attempt_count
          : 0;
      const nextAttempts = prevAttempts + 1;

      // Si ya alcanzó el máximo, liberamos lock y dejamos error “MAX_ATTEMPTS”
      if (nextAttempts >= MAX_ATTEMPTS) {
        const { error } = await supabase
          .from("appointments")
          .update({
            no_show_fee_attempt_count: nextAttempts,
            no_show_fee_last_attempt_at: nowIso,
            no_show_fee_last_error: "MAX_ATTEMPTS_REACHED",
            no_show_fee_processing_at: null, // liberar lock para que no se quede colgado
          })
          .eq("id", id);

        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }

        failedCount++;
        continue;
      }

      const fail = shouldFailDeterministically(id);

      if (fail) {
        // Fallo simulado: NO cobramos, mantenemos pending=true y charged=false, liberamos lock
        const { error } = await supabase
          .from("appointments")
          .update({
            no_show_fee_attempt_count: nextAttempts,
            no_show_fee_last_attempt_at: nowIso,
            no_show_fee_last_error: "SIMULATED_FAILURE",
            no_show_fee_processing_at: null,
          })
          .eq("id", id);

        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }

        failedCount++;
      } else {
        // Éxito: cobramos y limpiamos pending/lock/error
        const { error } = await supabase
          .from("appointments")
          .update({
            no_show_fee_attempt_count: nextAttempts,
            no_show_fee_last_attempt_at: nowIso,
            no_show_fee_last_error: null,
            no_show_fee_charged: true,
            no_show_fee_pending: false,
            no_show_fee_processing_at: null,
          })
          .eq("id", id);

        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }

        successCount++;
      }
    }

    return NextResponse.json(
      {
        ok: true,
        processedCount: rows.length,
        successCount,
        failedCount,
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
