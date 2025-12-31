import { NextResponse } from "next/server";
import { getServerContext } from "@/lib/server/context";

export const runtime = "nodejs";

const ALLOWED_CURRENCIES = ["EUR", "USD", "GBP"] as const;
type Currency = (typeof ALLOWED_CURRENCIES)[number];

function normalizeCurrency(input: unknown): Currency {
  const s = String(input ?? "").trim().toUpperCase();
  return (ALLOWED_CURRENCIES as readonly string[]).includes(s) ? (s as Currency) : "EUR";
}

export async function GET() {
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

  // Read clinic settings (one row by clinic_id)
  const { data: rows, error } = await ctx.supabaseAdmin
    .from("clinic_settings")
    .select(
      "grace_minutes,late_cancel_window_minutes,auto_charge_enabled,no_show_fee_cents,currency,clinic_id"
    )
    .eq("clinic_id", ctx.clinicId)
    .limit(1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const row = rows?.[0] ?? null;

  // profiles.currency as fallback (optional)
  const { data: prof } = await ctx.supabaseAdmin
    .from("profiles")
    .select("currency")
    .eq("id", ctx.user.id)
    .maybeSingle();

  const currency = normalizeCurrency(row?.currency ?? prof?.currency ?? "EUR");

  return NextResponse.json(
    {
      clinic_id: ctx.clinicId,
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

  const grace_minutes = Number(body.grace_minutes ?? 10);
  const late_cancel_window_minutes = Number(body.late_cancel_window_minutes ?? 60);
  const no_show_fee_cents = Number(body.no_show_fee_cents ?? 0);
  const auto_charge_enabled = Boolean(body.auto_charge_enabled ?? false);
  const currency = normalizeCurrency(body.currency);

  // Basic numeric sanity
  const gm = Number.isFinite(grace_minutes)
    ? Math.max(0, Math.min(240, Math.floor(grace_minutes)))
    : 10;

  const lcm = Number.isFinite(late_cancel_window_minutes)
    ? Math.max(0, Math.min(7 * 24 * 60, Math.floor(late_cancel_window_minutes)))
    : 60;

  const fee = Number.isFinite(no_show_fee_cents)
    ? Math.max(0, Math.min(1_000_000, Math.floor(no_show_fee_cents)))
    : 0;

  // Upsert settings by clinic_id
  const { error: upsertErr } = await ctx.supabaseAdmin
    .from("clinic_settings")
    .upsert(
      {
        clinic_id: ctx.clinicId,
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

  // Keep profiles.currency aligned (helpful default for other tables/UI)
  const { error: profErr } = await ctx.supabaseAdmin
    .from("profiles")
    .update({ currency })
    .eq("id", ctx.user.id);

  if (profErr) {
    return NextResponse.json(
      {
        ok: true,
        warning: `Saved settings but failed to update profile currency: ${profErr.message}`,
        currency,
      },
      { status: 200 }
    );
  }

  return NextResponse.json({ ok: true, currency }, { status: 200 });
}
