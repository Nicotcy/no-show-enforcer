import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

const ALLOWED_CURRENCIES = ["EUR", "USD", "GBP"] as const;
type Currency = (typeof ALLOWED_CURRENCIES)[number];

function normalizeCurrency(input: unknown): Currency {
  const s = String(input ?? "").trim().toUpperCase();
  return (ALLOWED_CURRENCIES as readonly string[]).includes(s) ? (s as Currency) : "EUR";
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
    .select("clinic_id,currency")
    .eq("id", user.id)
    .single();

  if (profileErr) {
    return { error: `Failed to read profile: ${profileErr.message}` } as const;
  }

  if (!profile?.clinic_id) return null;

  return {
    user,
    clinic_id: profile.clinic_id as string,
    profile_currency: profile.currency as string | null,
    supabaseAdmin,
  } as const;
}

export async function GET() {
  const ctx = await getContext();
  if (!ctx || "error" in ctx) {
    const msg = ctx && "error" in ctx ? ctx.error : "Unauthorized";
    return NextResponse.json({ error: msg }, { status: 401 });
  }

  // Read clinic settings (one row by clinic_id)
  const { data: rows, error } = await ctx.supabaseAdmin
    .from("clinic_settings")
    .select("grace_minutes,late_cancel_window_minutes,auto_charge_enabled,no_show_fee_cents,currency,clinic_id")
    .eq("clinic_id", ctx.clinic_id)
    .limit(1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const row = rows?.[0] ?? null;

  const currency = normalizeCurrency(row?.currency ?? ctx.profile_currency ?? "EUR");

  return NextResponse.json(
    {
      clinic_id: ctx.clinic_id,
      grace_minutes: row?.grace_minutes ?? 10,
      late_cancel_window_minutes: row?.late_cancel_window_minutes ?? 60,
      auto_charge_enabled: row?.auto_charge_enabled ?? false,
      no_show_fee_cents: row?.no_show_fee_cents ?? 0,
      currency,
    },
    { status: 200 }
  );
}

export async function POST(req: Request) {
  const ctx = await getContext();
  if (!ctx || "error" in ctx) {
    const msg = ctx && "error" in ctx ? ctx.error : "Unauthorized";
    return NextResponse.json({ error: msg }, { status: 401 });
  }

  const body = await req.json().catch(() => ({} as any));

  const grace_minutes = Number(body.grace_minutes ?? 10);
  const late_cancel_window_minutes = Number(body.late_cancel_window_minutes ?? 60);
  const no_show_fee_cents = Number(body.no_show_fee_cents ?? 0);
  const auto_charge_enabled = Boolean(body.auto_charge_enabled ?? false);
  const currency = normalizeCurrency(body.currency);

  // Basic numeric sanity
  const gm = Number.isFinite(grace_minutes) ? Math.max(0, Math.min(240, Math.floor(grace_minutes))) : 10;
  const lcm = Number.isFinite(late_cancel_window_minutes) ? Math.max(0, Math.min(7 * 24 * 60, Math.floor(late_cancel_window_minutes))) : 60;
  const fee = Number.isFinite(no_show_fee_cents) ? Math.max(0, Math.min(1_000_000, Math.floor(no_show_fee_cents))) : 0;

  // Upsert settings by clinic_id
  const { error: upsertErr } = await ctx.supabaseAdmin
    .from("clinic_settings")
    .upsert(
      {
        clinic_id: ctx.clinic_id,
        grace_minutes: gm,
        late_cancel_window_minutes: lcm,
        auto_charge_enabled,
        no_show_fee_cents: fee,
        currency,
      },
      { onConflict: "clinic_id" }
    );

  if (upsertErr) {
    return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  // Also keep profiles.currency aligned (optional but helpful)
  const { error: profErr } = await ctx.supabaseAdmin
    .from("profiles")
    .update({ currency })
    .eq("id", ctx.user.id);

  if (profErr) {
    // Not fatal; settings still saved
    return NextResponse.json(
      { ok: true, warning: `Saved settings but failed to update profile currency: ${profErr.message}`, currency },
      { status: 200 }
    );
  }

  return NextResponse.json({ ok: true, currency }, { status: 200 });
}
