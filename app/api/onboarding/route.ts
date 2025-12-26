import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

export async function POST(req: Request) {
  try {
    // 1) Read session user
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
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // 2) Parse body
    const body = await req.json().catch(() => ({} as any));
    const business_name = String(body?.business_name ?? "").trim();

    if (!business_name) {
      return NextResponse.json({ error: "Missing business_name" }, { status: 400 });
    }

    // 3) Admin client (bypass RLS)
    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 4) Get profile rows safely (NO .single())
    const { data: profileRows, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("id, clinic_id, currency, business_name")
      .eq("id", user.id);

    if (profileErr) {
      return NextResponse.json(
        { error: `Failed to read profile: ${profileErr.message}` },
        { status: 500 }
      );
    }

    let profile = profileRows?.[0] ?? null;

    // If profile missing, create it (minimal)
    if (!profile) {
      const { data: createdProfile, error: createProfileErr } = await supabaseAdmin
        .from("profiles")
        .insert({
          id: user.id,
          business_name: null,
          currency: "EUR",
          clinic_id: null,
        })
        .select("id, clinic_id, currency, business_name")
        .single();

      if (createProfileErr) {
        return NextResponse.json(
          { error: `Failed to create profile: ${createProfileErr.message}` },
          { status: 500 }
        );
      }

      profile = createdProfile;
    }

    // If already onboarded, return OK
    if (profile?.clinic_id) {
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

    // 6) Ensure clinic_settings exists (avoid duplicates crash)
    const { data: settingsRows, error: settingsReadErr } = await supabaseAdmin
      .from("clinic_settings")
      .select("id")
      .eq("clinic_id", clinic_id);

    if (settingsReadErr) {
      return NextResponse.json(
        { error: `Failed to read clinic_settings: ${settingsReadErr.message}` },
        { status: 500 }
      );
    }

    if (!settingsRows || settingsRows.length === 0) {
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
    }

    // 7) Attach clinic to profile (update by user.id)
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
