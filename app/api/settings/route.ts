import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

type SessionCtx =
  | { user: null; clinic_id: null; currency: null; supabaseAdmin: null }
  | { user: { id: string }; clinic_id: string | null; currency: string; supabaseAdmin: any };

async function getCtx(): Promise<SessionCtx> {
  const cookieStore = await cookies();

  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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

  if (!user) {
    return { user: null, clinic_id: null, currency: null, supabaseAdmin: null };
  }

  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .select("clinic_id, currency")
    .eq("id", user.id)
    .single();

  if (profileErr) throw new Error(`Failed to read profile: ${profileErr.message}`);

  return {
    user: { id: user.id },
    clinic_id: profile?.clinic_id ?? null,
    currency: profile?.currency ?? "EUR",
    supabaseAdmin,
  };
}

async function ensureSettingsRow(supabaseAdmin: any, clinic_id: string, currency: string) {
  const { data: rows, error } = await supabaseAdmin
    .from("clinic_settings")
    .select("*")
    .eq("clinic_id", clinic_id);

  if (error) throw new Error(`Failed to read clinic_settings: ${error.message}`);

  if (rows && rows.length > 0) return rows[0];

  const { data: created, error: createErr } = await supabaseAdmin
    .from("clinic_settings")
    .insert({
      clinic_id,
      grace_minutes: 10,
      late_cancel_window_minutes: 60,
      auto_charge_enabled: false,
      no_show_fee_cents: 0,
      currency,
    })
    .select("*")
    .single();

  if (createErr) throw new Error(`Failed to create clinic_settings: ${createErr.message}`);
  return created;
}

function normalizeCurrency(input: string) {
  // Minimal validation for now: only allow common ISO codes.
  const v = String(input || "").trim().toUpperCase();
  const allowed = ["EUR", "USD", "GBP"];
  return allowed.includes(v) ? v : "EUR";
}

export async function GET() {
  try {
    const ctx = await getCtx();
    if (!ctx.user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    if (!ctx.clinic_id) return NextResponse.json({ error: "Clinic not found for user" }, { status: 400 });

    const row = await ensureSettingsRow(ctx.supabaseAdmin, ctx.clinic_id, ctx.currency);

    return NextResponse.json(
      {
        grace_minutes: row.grace_minutes ?? 10,
        late_cancel_window_minutes: row.late_cancel_window_minutes ?? 60,
        no_show_fee_cents: row.no_show_fee_cents ?? 0,
        auto_charge_enabled: !!row.auto_charge_enabled,
        currency: row.currency ?? ctx.currency,
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unexpected error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await getCtx();
    if (!ctx.user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    if (!ctx.clinic_id) return NextResponse.json({ error: "Clinic not found for user" }, { status: 400 });

    const body = await req.json().catch(() => ({} as any));

    const grace_minutes = Number(body?.grace_minutes ?? 10);
    const late_cancel_window_minutes = Number(body?.late_cancel_window_minutes ?? 60);
    const no_show_fee_cents = Number(body?.no_show_fee_cents ?? 0);
    const auto_charge_enabled = Boolean(body?.auto_charge_enabled ?? false);
    const currency = normalizeCurrency(body?.currency ?? ctx.currency);

    // Ensure row exists
    await ensureSettingsRow(ctx.supabaseAdmin, ctx.clinic_id, ctx.currency);

    // IMPORTANT FIX: update by clinic_id (no id column)
    const { error: updErr } = await ctx.supabaseAdmin
      .from("clinic_settings")
      .update({
        grace_minutes,
        late_cancel_window_minutes,
        no_show_fee_cents,
        auto_charge_enabled,
        currency,
      })
      .eq("clinic_id", ctx.clinic_id);

    if (updErr) throw new Error(`Failed to update clinic_settings: ${updErr.message}`);

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unexpected error" }, { status: 500 });
  }
}
