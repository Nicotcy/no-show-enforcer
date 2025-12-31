import { NextResponse } from "next/server";
import { getServerContext } from "@/lib/server/context";

export const runtime = "nodejs";

const ALLOWED_STATUSES = [
  "scheduled",
  "checked_in",
  "late",
  "no_show",
  "canceled",
  "late_cancel",
] as const;

type Status = (typeof ALLOWED_STATUSES)[number];

function normalizeStatus(input: unknown): Status | null {
  const s = String(input ?? "").trim().toLowerCase();
  return (ALLOWED_STATUSES as readonly string[]).includes(s) ? (s as Status) : null;
}

function minutesUntil(start: Date, now: Date) {
  return Math.floor((start.getTime() - now.getTime()) / 60000);
}

// Parse starts_at as UTC.
// If it has no timezone suffix (Z or +/-hh:mm), treat it as UTC and append Z.
function parseStartsAtUtc(raw: unknown): Date | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  const hasTz =
    s.endsWith("Z") || /[+\-]\d{2}:\d{2}$/.test(s) || /[+\-]\d{2}\d{2}$/.test(s);

  const iso = hasTz ? s : `${s}Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const { id: appointmentId } = await params;

  const body = await req.json().catch(() => ({} as any));
  const action = String(body.action ?? "").trim(); // "check_in" | "" (default set_status)

  // Load current appointment (must belong to this clinic)
  const { data: apptRows, error: apptErr } = await ctx.supabaseAdmin
    .from("appointments")
    .select("id, clinic_id, status, starts_at, checked_in_at, no_show_excused, cancelled_at")
    .eq("id", appointmentId)
    .eq("clinic_id", ctx.clinicId)
    .limit(1);

  if (apptErr) return NextResponse.json({ error: apptErr.message }, { status: 500 });

  const current = apptRows?.[0];
  if (!current) return NextResponse.json({ error: "Appointment not found" }, { status: 404 });

  const currentStatus = normalizeStatus(current.status) ?? "scheduled";
  const hasCheckedIn = Boolean(current.checked_in_at);

  // Terminal rule: canceled and late_cancel are terminal
  if (currentStatus === "canceled" || currentStatus === "late_cancel") {
    return NextResponse.json(
      { error: "Canceled appointments cannot be modified." },
      { status: 400 }
    );
  }

  // Check-in
  if (action === "check_in") {
    const { data: updated, error: updErr } = await ctx.supabaseAdmin
      .from("appointments")
      .update({
        checked_in_at: new Date().toISOString(),
        status: "checked_in",
      })
      .eq("id", appointmentId)
      .eq("clinic_id", ctx.clinicId)
      .select("*")
      .maybeSingle();

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, appointment: updated }, { status: 200 });
  }

  // Default: set_status
  const nextStatus = normalizeStatus(body.status);
  if (!nextStatus) {
    return NextResponse.json(
      { error: `Invalid status. Allowed: ${ALLOWED_STATUSES.join(", ")}` },
      { status: 400 }
    );
  }

  // Rule: if already checked in, cannot be set to no_show
  if (hasCheckedIn && nextStatus === "no_show") {
    return NextResponse.json(
      { error: "Checked-in appointments cannot be marked as no-show." },
      { status: 400 }
    );
  }

  // Status immutability rules
  if (currentStatus === "checked_in" && nextStatus !== "checked_in") {
    return NextResponse.json(
      { error: "Checked-in appointments cannot change status." },
      { status: 400 }
    );
  }

  if (currentStatus === "no_show" && nextStatus !== "no_show") {
    return NextResponse.json(
      { error: "No-show appointments cannot change status (use Excuse)." },
      { status: 400 }
    );
  }

  // Implement late cancel when client requests "canceled"
  let statusToSave: Status = nextStatus;
  const patch: Record<string, any> = {};

  if (nextStatus === "canceled") {
    const now = new Date();
    patch.cancelled_at = now.toISOString();

    // Load clinic setting late_cancel_window_minutes
    const { data: settingsRow, error: settingsErr } = await ctx.supabaseAdmin
      .from("clinic_settings")
      .select("late_cancel_window_minutes")
      .eq("clinic_id", ctx.clinicId)
      .maybeSingle();

    if (settingsErr) {
      return NextResponse.json(
        { error: `Failed to read clinic settings: ${settingsErr.message}` },
        { status: 500 }
      );
    }

    const windowMinsRaw = Number(settingsRow?.late_cancel_window_minutes ?? 60);
    const windowMins = Number.isFinite(windowMinsRaw)
      ? Math.max(0, Math.min(10080, Math.floor(windowMinsRaw)))
      : 60;

    const start = parseStartsAtUtc(current.starts_at);

    // late cancel only makes sense if appointment is still in the future
    if (start && windowMins > 0) {
      const minsUntil = minutesUntil(start, now);

      if (minsUntil >= 0 && minsUntil <= windowMins) {
        statusToSave = "late_cancel";
      } else {
        statusToSave = "canceled";
      }
    } else {
      statusToSave = "canceled";
    }
  }

  patch.status = statusToSave;

  const { data: updated, error: updErr } = await ctx.supabaseAdmin
    .from("appointments")
    .update(patch)
    .eq("id", appointmentId)
    .eq("clinic_id", ctx.clinicId)
    .select("*")
    .maybeSingle();

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, appointment: updated }, { status: 200 });
}
