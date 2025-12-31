import { NextResponse } from "next/server";
import { getServerContext } from "@/lib/server/context";

export const runtime = "nodejs";

const ALLOWED_STATUSES = ["scheduled", "checked_in", "late", "no_show", "canceled"] as const;
type Status = (typeof ALLOWED_STATUSES)[number];

function normalizeStatus(input: unknown): Status | null {
  const s = String(input ?? "").trim().toLowerCase();
  return (ALLOWED_STATUSES as readonly string[]).includes(s) ? (s as Status) : null;
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
  const { data: appt, error: apptErr } = await ctx.supabaseAdmin
    .from("appointments")
    .select("id,clinic_id,status,checked_in_at,no_show_excused")
    .eq("id", appointmentId)
    .eq("clinic_id", ctx.clinicId)
    .limit(1);

  if (apptErr) return NextResponse.json({ error: apptErr.message }, { status: 500 });

  const current = appt?.[0];
  if (!current) return NextResponse.json({ error: "Appointment not found" }, { status: 404 });

  const currentStatus = normalizeStatus(current.status) ?? "scheduled";
  const hasCheckedIn = Boolean(current.checked_in_at);

  // Terminal rule: canceled is terminal
  if (currentStatus === "canceled") {
    return NextResponse.json(
      { error: "Canceled appointments cannot be modified." },
      { status: 400 }
    );
  }

  // Check-in
  if (action === "check_in") {
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

  const { error: updErr } = await ctx.supabaseAdmin
    .from("appointments")
    .update({ status: nextStatus })
    .eq("id", appointmentId)
    .eq("clinic_id", ctx.clinicId);

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true }, { status: 200 });
}
