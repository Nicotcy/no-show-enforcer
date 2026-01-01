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
    .select("id, clinic_id, status, checked_in_at, no_show_excused")
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

// si se cancela o se hace check-in, nunca debe quedar nada de cobro pendiente/charged
if (nextStatus === "canceled" || nextStatus === "checked_in") {
  updatePayload.no_show_fee_pending = false;
  updatePayload.no_show_fee_charged = false;
}

// coherencia manual = cron
if (nextStatus === "no_show") {
  updatePayload.no_show_detected_at = new Date().toISOString();

  // pending solo si: auto_charge_enabled=true y fee>0 y NO está excusado
  const excused = Boolean(appt.no_show_excused);
  if (excused) {
    updatePayload.no_show_fee_pending = false;
    updatePayload.no_show_fee_charged = false;
  } else {
    try {
      const rule = await getClinicChargeRule(ctx.supabaseAdmin, ctx.clinicId);
      updatePayload.no_show_fee_pending =
        rule.autoChargeEnabled && rule.feeCents > 0;
      updatePayload.no_show_fee_charged = false;
    } catch (e: any) {
      return NextResponse.json(
        { error: e?.message || "Failed to load clinic charge rule" },
        { status: 500 }
      );
    }
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
