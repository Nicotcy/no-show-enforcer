import { NextResponse } from "next/server";
import { getServerContext } from "@/lib/server/context";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let ctx;
  try {
    ctx = await getServerContext();
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to load context" },
      { status: 500 }
    );
  }

  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const id = String(body?.id || "").trim();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  // Retry conservador:
  // - dejamos pending=true, charged=false
  // - liberamos processing_at (por si quedó colgado)
  // - limpiamos last_error (para que vuelva a “pending”)
  // - NO tocamos attempt_count (se mantiene el historial)
  const { data, error } = await ctx.supabaseAdmin
    .from("appointments")
    .update({
      no_show_fee_pending: true,
      no_show_fee_charged: false,
      no_show_fee_processing_at: null,
      no_show_fee_last_error: null,
    })
    .eq("id", id)
    .eq("clinic_id", ctx.clinicId)
    .select(
      "id, no_show_fee_pending, no_show_fee_charged, no_show_fee_processing_at, no_show_fee_attempt_count, no_show_fee_last_error"
    )
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ ok: true, appointment: data }, { status: 200 });
}
