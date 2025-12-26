import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  try {
    // 1) Read session user (anon key + cookies)
    const cookieStore = await cookies();

    const supabaseAuth = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
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

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // 2) Parse body
    const body = await req.json().catch(() => ({} as any));
    const business_name = String(body?.business_name ?? "").trim();

    if (!business_name) {
      return NextResponse.json(
        { error: "Missing business_name" },
        { status: 400 }
      );
    }

    // 3) Service role client (bypass RLS)
    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 4) Read profile (admin) - check if already onboarded
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("id, clinic_id, business_name, timezone, currency")
      .eq("id", user.id)
      .single();

    if (profileErr) {
      return NextResponse.json(
        { error: `Failed to read profile: ${profileErr.message}` },
        { status: 500 }
      );
    }

    if (profile?.clinic_id) {
      // Idempotent: already onboarded
      return NextResponse.json(
        { ok: true, clinic_id: profile.clinic_id, already_onboarded: true },
        { status: 200 }
      );
    }

    // 5) Create clinic
    const { data: clinicRow, error: clinicErr } = await supabaseAdmin
      .from("clinics")
      .insert({ name: business_name })
      .select("id")
      .single();

    if (clinicErr || !clinicRow?.id) {
      return NextResponse.json(
        { error: `Failed to create clinic: ${clinicErr?.message ?? "unknown"}` },
        { status: 500 }
      );
    }

    const clinic_id = clinicRow.id;

    // 6) Create default clinic_settings
    const { error: settingsErr } = await supabaseAdmin
      .from("clinic_settings")
      .insert({
        clinic_id,
        grace_minutes: 10,
        late_cancel_window_minutes: 60,
        auto_charge_enabled: false,
        no_show_fee_cents: 0,
        currency: profile?.currency ?? "EUR",
      });

    if (settingsErr) {
      return NextResponse.json(
        { error: `Failed to create clinic_settings: ${settingsErr.message}` },
        { status: 500 }
      );
    }

    // 7) Update profile -> attach clinic_id + business_name
    const { error: updErr } = await supabaseAdmin
      .from("profiles")
      .update({
        clinic_id,
        business_name,
      })
      .eq("id", user.id);

    if (updErr) {
      return NextResponse.json(
        { error: `Failed to update profile: ${updErr.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, clinic_id }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unexpected error" },
      { status: 500 }
    );
  }
}
