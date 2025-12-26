import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getAuthClient(req: NextRequest) {
  // Lee la sesión del usuario (cookies) con anon key
  const res = NextResponse.next();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // No necesitamos setear nada aquí para onboarding, pero lo dejamos correcto
          for (const { name, value, options } of cookiesToSet) {
            res.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  return { supabase, res };
}

const admin = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } }
);

export async function POST(req: NextRequest) {
  const { supabase } = getAuthClient(req);

  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = data.user.id;

  // 1) ¿Ya tiene clinic_id en profiles?
  const { data: profile, error: profErr } = await admin
    .from("profiles")
    .select("id, clinic_id")
    .eq("id", userId)
    .maybeSingle();

  if (profErr) {
    return NextResponse.json({ error: profErr.message }, { status: 500 });
  }

  if (profile?.clinic_id) {
    return NextResponse.json(
      { ok: true, clinic_id: profile.clinic_id, created: false },
      { status: 200 }
    );
  }

  // 2) Crea clinic
  const { data: clinic, error: clinicErr } = await admin
    .from("clinics")
    .insert({ name: null })
    .select("id")
    .single();

  if (clinicErr) {
    return NextResponse.json({ error: clinicErr.message }, { status: 500 });
  }

  const clinicId = clinic.id;

  // 3) Crea clinic_settings (si ya existiera por alguna razón, upsert)
  const { error: settingsErr } = await admin
    .from("clinic_settings")
    .upsert(
      {
        clinic_id: clinicId,
        grace_minutes: 10,
        late_cancel_window_minutes: 1440,
        auto_charge_enabled: false,
        no_show_fee_cents: 0,
        currency: "EUR",
      },
      { onConflict: "clinic_id" }
    );

  if (settingsErr) {
    return NextResponse.json({ error: settingsErr.message }, { status: 500 });
  }

  // 4) Upsert profile con clinic_id
  const { error: upsertErr } = await admin.from("profiles").upsert(
    {
      id: userId,
      clinic_id: clinicId,
      business_name: null,
      timezone: "Europe/Madrid",
      currency: "EUR",
      no_show_fee: 0,
      late_cancel_fee: 0,
      late_cancel_window_hours: 24,
    },
    { onConflict: "id" }
  );

  if (upsertErr) {
    return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  return NextResponse.json(
    { ok: true, clinic_id: clinicId, created: true },
    { status: 200 }
  );
}
