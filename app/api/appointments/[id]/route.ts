import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

const ALLOWED_STATUSES = ["scheduled", "checked_in", "late", "no_show", "canceled"] as const;
type Status = (typeof ALLOWED_STATUSES)[number];

function normalizeStatus(input: unknown): Status | null {
  const s = String(input ?? "").trim().toLowerCase();
  return (ALLOWED_STATUSES as readonly string[]).includes(s) ? (s as Status) : null;
}

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

  const { data: { user } } = await supabaseAuth.auth.getUser();
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

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await getContext();
  if (!ctx || "error" in ctx) {
    const msg = ctx && "error" in ctx ? ctx.error : "Unauthorized";
    return NextResponse.json({ error: msg }, { status: 401 });
  }

  const appointmentId = params.id;

  const body = await req.json().catch(() => ({} as any));
  const action = String(body.action ?? "").trim(); // optional: "set_status" | "excuse" | "check_in"

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

  // Terminal rule: canceled is terminal
  if (currentStatus === "canceled") {
    return NextResponse.json(
      { error: "Canceled appointments cannot be modified." },
      { status: 400 }
    );
  }

  // Action handlers
  if (action === "excuse") {
    // Excuse only makes sense for no_show
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
      })
      .eq("id", appointmentId)
      .eq("clinic_id", ctx.clinic_id);

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    return NextResponse.json({ ok: true }, { status: 200 });
  }

  if (action === "check_in") {
    // Check-in sets checked_in_at and status checked_in
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

  // Rule: if already checked in, cannot be set to no_show
  if (hasCheckedIn && nextStatus === "no_show") {
    return NextResponse.json(
      { error: "Checked-in appointments cannot be marked as no-show." },
      { status: 400 }
    );
  }

  // Minimal transitions (simple + safe):
  // - scheduled -> late / checked_in / canceled / no_show
  // - late -> checked_in / canceled / no_show
  // - no_show -> (can still be excused via action=excuse; status stays no_show)
  // - checked_in -> (allow cancel? no. keep it stable)
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
    .eq("clinic_id", ctx.clinic_id);

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true }, { status: 200 });
}
