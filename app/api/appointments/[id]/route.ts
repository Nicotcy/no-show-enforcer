/**
 * IMPORTANT:
 * This is an API route file (NO JSX / NO React components).
 * If you see <div>, <tr>, useState, etc. you are in the wrong place.
 */

import { NextResponse } from "next/server";
import { getServerContext } from "@/lib/server/context";
import {
  ALLOWED_STATUSES,
  normalizeStatus,
  validateStatusTransition,
} from "@/lib/appointments/status";

export const runtime = "nodejs";

const UNDO_NO_SHOW_WINDOW_MINUTES = 30;

async function getClinicChargeRule(supabaseAdmin: any, clinicId: string) {
  const { data, error } = await supabaseAdmin
    .from("clinic_settings")
    .select("auto_charge_enabled, no_show_fee_cents")
    .eq("clinic_id", clinicId)
    .limit(1);

  if (error) throw new Error(`Failed to read clinic_settings: ${error.message}`);

  const row = data?.[0] ?? null;
  const autoChargeEnabled = Boolean(row?.auto_charge_enabled);
  const feeCents =
    typeof row?.no_show_fee_cents === "number" ? row.no_show_fee_cents : 0;

  return { autoChargeEnabled, feeCents };
}

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

  // Load current appointment (scoped by clinic)
  const { data: appt, error: apptErr } = await ctx.supabaseAdmin
    .from("appointments")
    .select(
      "id, clinic_id, starts_at, status, checked_in_at, cancelled_at, no_show_excused, no_show_excuse_reason, no_show_detected_at, no_show_fee_pending, no_show_fee_charged"
    )
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

  // Action: check_in (guarda timestamp real + limpia flags de cobro)
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
        no_show_fee_pending: false,
        no_show_fee_charged: false,
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

  // ✅ UNDO seguro: permitir volver a scheduled desde late o no_show con reglas
  const isUndoToScheduled =
    nextStatus === "scheduled" &&
    (currentStatus === "late" || currentStatus === "no_show");

  if (!isUndoToScheduled) {
    const transitionErr = validateStatusTransition(currentStatus, nextStatus, {
      hasCheckedIn,
    });
    if (transitionErr) {
      return NextResponse.json({ error: transitionErr }, { status: 400 });
    }
  } else {
    if (hasCheckedIn) {
      return NextResponse.json(
        { error: "Checked-in appointments cannot change status." },
        { status: 400 }
      );
    }

    if (currentStatus === "no_show") {
      if (appt.no_show_fee_charged) {
        return NextResponse.json(
          { error: "Cannot undo a no-show that has already been charged." },
          { status: 400 }
        );
      }

      const detectedAt = appt.no_show_detected_at as string | null | undefined;
      if (detectedAt) {
        const detectedMs = new Date(detectedAt).getTime();
        if (!Number.isNaN(detectedMs)) {
          const ageMinutes = (Date.now() - detectedMs) / 60000;
          if (ageMinutes > UNDO_NO_SHOW_WINDOW_MINUTES) {
            return NextResponse.json(
              {
                error:
                  `Undo window expired (${UNDO_NO_SHOW_WINDOW_MINUTES} min). ` +
                  "Use Excuse if you need to waive the fee.",
              },
              { status: 400 }
            );
          }
        }
      }
    }
  }

  // ✅ no_show NO permitido en futuras
  if (nextStatus === "no_show") {
    const startsAt = appt.starts_at as string | null | undefined;
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

  const updatePayload: Record<string, any> = { status: nextStatus };

  // Undo to scheduled: limpiar TODO lo que “ensucia” outcomes/cobros
  if (nextStatus === "scheduled") {
    updatePayload.checked_in_at = null;
    updatePayload.cancelled_at = null;
    updatePayload.no_show_detected_at = null;
    updatePayload.no_show_fee_pending = false;
    updatePayload.no_show_fee_charged = false;
    updatePayload.no_show_excused = false;
    updatePayload.no_show_excuse_reason = null;
  }

  // Cancel: registra hora y limpia cobros
  if (nextStatus === "canceled") {
    updatePayload.cancelled_at = new Date().toISOString();
    updatePayload.no_show_fee_pending = false;
    updatePayload.no_show_fee_charged = false;
  }

  // Checked_in: limpia cobros
  if (nextStatus === "checked_in") {
    updatePayload.no_show_fee_pending = false;
    updatePayload.no_show_fee_charged = false;
  }

  // No-show: coherencia manual = cron
  if (nextStatus === "no_show") {
    updatePayload.no_show_detected_at = new Date().toISOString();

    const excused = Boolean(appt.no_show_excused);
    if (excused) {
      updatePayload.no_show_fee_pending = false;
      updatePayload.no_show_fee_charged = false;
    } else {
      const rule = await getClinicChargeRule(ctx.supabaseAdmin, ctx.clinicId);
      updatePayload.no_show_fee_pending = rule.autoChargeEnabled && rule.feeCents > 0;
      updatePayload.no_show_fee_charged = false;
    }
  }

  const { error: updErr } = await ctx.supabaseAdmin
    .from("appointments")
    .update(updatePayload)
    .eq("id", appointmentId)
    .eq("clinic_id", ctx.clinicId);

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true }, { status: 200 });
}
