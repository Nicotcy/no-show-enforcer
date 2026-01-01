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

    // 1) Buscar filas lockeadas y pendientes
    const { data: rows, error: fetchError } = await supabase
      .from("appointments")
      .select("id")
      .eq("status", "no_show")
      .eq("no_show_fee_pending", true)
      .eq("no_show_fee_charged", false)
      .not("no_show_fee_processing_at", "is", null)
      .limit(BATCH_SIZE);

    if (fetchError) {
      return NextResponse.json(
        { error: fetchError.message },
        { status: 500 }
      );
    }

    if (!rows || rows.length === 0) {
      return NextResponse.json(
        { ok: true, processedCount: 0 },
        { status: 200 }
      );
    }

    const ids = rows.map((r: any) => String(r.id));

    // 2) Simular cobro exitoso
    const { error: updateError } = await supabase
      .from("appointments")
      .update({
        no_show_fee_charged: true,
        no_show_fee_pending: false,
        no_show_fee_processing_at: null,
        no_show_fee_last_attempt_at: nowIso,
      })
      .in("id", ids);

    if (updateError) {
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { ok: true, processedCount: ids.length },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unexpected error" },
      { status: 500 }
    );
  }
}
