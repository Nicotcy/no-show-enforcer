import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

import {
  ALLOWED_STATUSES,
  normalizeStatus,
  validateStatusTransition,
} from "@/lib/appointments/status";

export const runtime = "nodejs";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

async function getContext() {
  const cookieStore = await cookies();

  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
  if (!user) return null;

  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string
  );

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .select("clinic_id")
    .eq("id", user.id)
    .single();

  if (profileErr) return { error: `Failed to read profile: ${profileErr.message}` } as const;
  if (!profile?.clinic_id) return null;

  return { user, clinic_id: profile.clinic_id as string, supabaseAdmin } as const;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getContext();
  if (!ctx || "error" in ctx) {
    const msg = ctx && "error" in ctx ? ctx.error : "Unauthorized";
    return NextResponse.json({ error: msg }, { status: 401 });
  }

  const { id: appointmentId } = await params;

  const body = await req.json().catch(() => ({} as any));
  const action = String(body.action ?? "").trim();

  // Load current appointment (must belong to this clinic)
  const { data: appt, error: apptErr } = await ctx.supabaseAdmin
    .from("appointments")
    .select("id,clinic_id,status,checked_in_at,no_show_excused")
    .eq("id", appointmentId)
    .eq("clinic_id", ctx.clinic_id)
    .limit(1);

  if (apptErr) return NextResponse.json({ error: apptErr.message }, { status: 500 });

  const current = appt?.[0];
  if (!current) return NextResponse.json({ error: "Appointment not found" }, { status: 404 });

  const currentStatus = normalizeStatus(current.status) ?? "scheduled";
  const hasCheckedIn = Boolean(current.checked_in_at);

  // Excuse
  if (action === "excuse") {
    if (currentStatus !== "no_show") {
      return NextResponse.json(
        { error: "Only no-show appointments can be excused." },
        { status: 400 }
      );
    }
    // Excuse
if (action === "excuse") {
  if (currentStatus !== "no_show") {
    return NextResponse.json(
      { error: "Only no-show appointments can be excused." },
      { status: 400 }
    );
  }

  const reason = typeof body.reason === "string" ? body.reason.trim() : null;

  const { error: updErr } = await ctx.supabaseAdmin
    .from("appointments")
    .update({
      no_show_excused: true,
      no_show_excuse_reason: reason,
      // al excusar, anulamos cualquier intento de cobro
      no_show_fee_pending: false,
      no_show_fee_charged: false,
    })
    .eq("id", appointmentId)
    .eq("clinic_id", ctx.clinic_id);

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true }, { status: 200 });
}

  // Check-in
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
      .eq("clinic_id", ctx.clinic_id);

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
    .eq("clinic_id", ctx.clinic_id);

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true }, { status: 200 });
}
}
