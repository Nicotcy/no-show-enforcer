import { NextResponse } from "next/server";
import { getServerContext } from "@/lib/server/context";
import {
  ALLOWED_STATUSES,
  normalizeStatus,
  validateStatusTransition,
} from "@/lib/appointments/status";

export const runtime = "nodejs";

async function getClinicChargeRule(supabaseAdmin: any, clinicId: string) {
  const { data, error } = await supabaseAdmin
    .from("clinic_settings")
    .select("auto_charge_enabled, no_show_fee_cents")
    .eq("clinic_id", clinicId)
    .limit(1);

  if (error) throw error;

  const row = data?.[0] ?? null;

  return {
    auto_charge_enabled: Boolean(row?.auto_charge_enabled),
    no_show_fee_cents: Number(row?.no_show_fee_cents ?? 0),
  };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getServerContext(req);
  if ("error" in ctx) return ctx.error;

  const { id: appointmentId } = await params;

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "");
  const status = String(body?.status || "");

  if (!action) {
    return NextResponse.json({ error: "Missing action" }, { status: 400 });
  }

  // Fetch appointment (scoped to clinic)
  const { data: appt, error: apptErr } = await ctx.supabaseAdmin
    .from("appointments")
    .select("id, clinic_id, starts_at, status, checked_in_at, no_show_excused")
    .eq("id", appointmentId)
    .eq("clinic_id", ctx.clinicId)
    .maybeSingle();

  if (apptErr) return NextResponse.json({ error: apptErr.message }, { status: 500 });
  if (!appt) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const currentStatus = normalizeStatus(appt.status);
  let nextStatus = currentStatus;

  // Build update payload
  const updatePayload: Record<string, any> = {};

  if (action === "set_status") {
    const normalized = normalizeStatus(status);

    if (!normalized || !ALLOWED_STATUSES.includes(normalized)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    nextStatus = normalized;

    // Validate transition rules (centralized)
    const transitionErr = validateStatusTransition(currentStatus, nextStatus);
    if (transitionErr) {
      return NextResponse.json({ error: transitionErr }, { status: 400 });
    }

    // Hard rule: no se puede marcar no_show en citas futuras (backend source of truth)
    if (nextStatus === "no_show") {
      const startsAt = appt?.starts_at as string | null | undefined;
      if (startsAt) {
        const startsMs = new Date(startsAt).getTime();
        if (!Number.isNaN(startsMs) && startsMs > Date.now()) {
          return NextResponse.json(
            { error: "Cannot mark a future appointment as no_show" },
            { status: 400 }
          );
        }
      }
    }

    updatePayload.status = nextStatus;

    // Side effects per status
    if (nextStatus === "checked_in") {
      updatePayload.checked_in_at = new Date().toISOString();
      // Clean up any billing flags
      updatePayload.no_show_fee_pending = false;
      updatePayload.no_show_fee_charged = false;
      updatePayload.no_show_detected_at = null;
      updatePayload.no_show_excused = false;
      updatePayload.no_show_excuse_reason = null;
    }

    if (nextStatus === "canceled") {
      updatePayload.cancelled_at = new Date().toISOString();
      // Clean up any billing flags
      updatePayload.no_show_fee_pending = false;
      updatePayload.no_show_fee_charged = false;
      updatePayload.no_show_detected_at = null;
      updatePayload.no_show_excused = false;
      updatePayload.no_show_excuse_reason = null;
    }

    if (nextStatus === "no_show") {
      updatePayload.no_show_detected_at = new Date().toISOString();
      updatePayload.no_show_excused = false;
      updatePayload.no_show_excuse_reason = null;

      // Prepare fee (pending) depending on clinic settings
      const rule = await getClinicChargeRule(ctx.supabaseAdmin, ctx.clinicId);
      const shouldPending =
        rule.auto_charge_enabled && rule.no_show_fee_cents > 0;

      updatePayload.no_show_fee_pending = shouldPending;
      updatePayload.no_show_fee_charged = false;
    }

    if (nextStatus === "late") {
      // no extra side effects for now
    }

    if (nextStatus === "scheduled") {
      // reset timestamps when moving back to scheduled (if allowed by transition rules)
      updatePayload.checked_in_at = null;
      updatePayload.cancelled_at = null;
      updatePayload.no_show_detected_at = null;
      updatePayload.no_show_fee_pending = false;
      updatePayload.no_show_fee_charged = false;
      updatePayload.no_show_excused = false;
      updatePayload.no_show_excuse_reason = null;
    }
  } else if (action === "check_in") {
    // Keep current status rules: check_in always sets checked_in_at and sets status checked_in
    nextStatus = "checked_in";

    const transitionErr = validateStatusTransition(currentStatus, nextStatus);
    if (transitionErr) {
      return NextResponse.json({ error: transitionErr }, { status: 400 });
    }

    updatePayload.status = nextStatus;
    updatePayload.checked_in_at = new Date().toISOString();

    // Clean up billing flags
    updatePayload.no_show_fee_pending = false;
    updatePayload.no_show_fee_charged = false;
    updatePayload.no_show_detected_at = null;
    updatePayload.no_show_excused = false;
    updatePayload.no_show_excuse_reason = null;
  } else {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const { error: updErr } = await ctx.supabaseAdmin
    .from("appointments")
    .update(updatePayload)
    .eq("id", appointmentId)
    .eq("clinic_id", ctx.clinicId);

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true }, { status: 200 });
}
