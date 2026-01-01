import { NextResponse } from "next/server";
import { getServerContext } from "@/lib/server/context";
import {
  ALLOWED_STATUSES,
  normalizeStatus,
  validateStatusTransition,
} from "@/lib/appointments/status";

export const runtime = "nodejs";

export async function PATCH(
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

  const body = await req.json().catch(() => ({} as any));
  const action = String(body.action ?? "").trim();

  // Load current appointment (scoped by clinic_id)
  const { data: appt, error: apptErr } = await ctx.supabaseAdmin
    .from("appointments")
    .select("id, clinic_id, status, checked_in_at")
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
    return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
  }

  const currentStatus = normalizeStatus(appt.status) ?? "scheduled";
  const hasCheckedIn = Boolean(appt.checked_in_at);

  // Action: check_in (guarda timestamp real)
  if (action === "check_in") {
    const transitionErr = validateStatusTransition(currentStatus, "checked_in", {
      hasCheckedIn,
    });

    if (transitionErr) {
      return NextResponse.json({ error: transitionErr }, { status: 400 });
    }

    const { error: updErr } = await ctx.supabaseAdmin
      .from("appointments")
      .update({
        checked_in_at: new Date().toISOString(),
        status: "checked_in",
      })
      .eq("id", appointmentId)
      .eq("clinic_id", ctx.clinicId);

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    return NextResponse.json({ ok: true }, { status: 200 });
  }

  // Default: set_status
  const nextStatus = normalizeStatus(body.status);
  if (!nextStatus) {
    return NextResponse.json(
      { error: `Invalid status. Allowed: ${ALLOWED_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  const transitionErr = validateStatusTransition(currentStatus, nextStatus, {
    hasCheckedIn,
  });

  if (transitionErr) {
    return NextResponse.json({ error: transitionErr }, { status: 400 });
  }

  const updatePayload: Record<string, any> = { status: nextStatus };

  // Si se marca como no_show manualmente, guardamos también el momento de detección.
  if (nextStatus === "no_show") {
    updatePayload.no_show_detected_at = new Date().toISOString();
  }

  const { error: updErr } = await ctx.supabaseAdmin
    .from("appointments")
    .update(updatePayload)
    .eq("id", appointmentId)
    .eq("clinic_id", ctx.clinicId);

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true }, { status: 200 });
}
