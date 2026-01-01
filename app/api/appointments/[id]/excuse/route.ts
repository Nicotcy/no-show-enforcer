import { NextResponse } from "next/server";
import { getServerContext } from "@/lib/server/context";

export const runtime = "nodejs";

function normalizeReason(input: any): string | null {
  if (typeof input !== "string") return null;
  const t = input.trim();
  return t.length ? t : null;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: appointmentId } = await params;

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

  // ensure the appointment belongs to this clinic (scoped query: no info leak)
  const { data: appt, error: apptErr } = await ctx.supabaseAdmin
    .from("appointments")
    .select("id, clinic_id, status, no_show_excused")
    .eq("id", appointmentId)
    .eq("clinic_id", ctx.clinicId)
    .maybeSingle();

  if (apptErr) {
    return NextResponse.json(
      { error: `Failed to read appointment: ${apptErr.message}` },
      { status: 500 }
    );
  }

  if (!appt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (String(appt.status) !== "no_show") {
    return NextResponse.json(
      { error: "Only no-show appointments can be excused." },
      { status: 400 }
    );
  }

  let reason: string | null = null;
  try {
    const body = await req.json();
    reason = normalizeReason(body?.reason);
  } catch {
    reason = null;
  }

  const { data: updated, error: updErr } = await ctx.supabaseAdmin
    .from("appointments")
    .update({
      no_show_excused: true,
      no_show_excuse_reason: reason,
      // si se excusa, se cancela cualquier cola/cobro asociado
      no_show_fee_pending: false,
      no_show_fee_charged: false,
    })
    .eq("id", appointmentId)
    .eq("clinic_id", ctx.clinicId)
    .select(
      "id, status, no_show_excused, no_show_excuse_reason, no_show_fee_pending, no_show_fee_charged"
    )
    .maybeSingle();

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, appointment: updated }, { status: 200 });
}
