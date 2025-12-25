import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getClinicIdForUser } from "@/lib/getClinicId";

export const runtime = "nodejs";

// Service role para leer/escribir en DB sin depender de RLS
const admin = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } }
);

const DEFAULT_SETTINGS = {
  grace_minutes: 15,
  late_cancel_window_minutes: 1440,
  auto_charge_enabled: false,
  no_show_fee_cents: 0,
  currency: "EUR",
};

function getSupabaseServerClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.SUPABASE_URL as string,
    // suele ser NEXT_PUBLIC_SUPABASE_ANON_KEY (o SUPABASE_ANON_KEY si lo guardaste así)
    (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY) as string,
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
}

async function resolveClinicId(req: Request) {
  const url = new URL(req.url);

  // 1) si viene por query param, lo usamos (modo debug / admin)
  const clinicIdFromQuery = url.searchParams.get("clinic_id");
  if (clinicIdFromQuery) return clinicIdFromQuery;

  // 2) si no, lo sacamos del usuario logueado (cookies)
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data?.user) return null;

  // tu helper espera string (userId)
  const clinicId = await getClinicIdForUser(data.user.id);
  return clinicId ?? null;
}

export async function GET(req: Request) {
  const clinicId = await resolveClinicId(req);

  if (!clinicId) {
    return NextResponse.json(
      { error: "Unauthorized or clinic not found for user" },
      { status: 401 }
    );
  }

  const { data, error } = await admin
    .from("clinic_settings")
    .select("*")
    .eq("clinic_id", clinicId)
    .single();

  // si no existe fila -> crear defaults
  if (error && error.code === "PGRST116") {
    const { data: created, error: createErr } = await admin
      .from("clinic_settings")
      .insert({ clinic_id: clinicId, ...DEFAULT_SETTINGS })
      .select()
      .single();

    if (createErr) {
      return NextResponse.json({ error: createErr.message }, { status: 500 });
    }
    return NextResponse.json(created, { status: 200 });
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 200 });
}

export async function PUT(req: Request) {
  const clinicId = await resolveClinicId(req);

  if (!clinicId) {
    return NextResponse.json(
      { error: "Unauthorized or clinic not found for user" },
      { status: 401 }
    );
  }

  const body = await req.json();

  const updateData: any = {};
  if (body.grace_minutes !== undefined)
    updateData.grace_minutes = body.grace_minutes;
  if (body.late_cancel_window_minutes !== undefined)
    updateData.late_cancel_window_minutes = body.late_cancel_window_minutes;
  if (body.auto_charge_enabled !== undefined)
    updateData.auto_charge_enabled = body.auto_charge_enabled;
  if (body.no_show_fee_cents !== undefined)
    updateData.no_show_fee_cents = body.no_show_fee_cents;
  if (body.currency !== undefined) updateData.currency = body.currency;

  updateData.updated_at = new Date().toISOString();

  const { data, error } = await admin
    .from("clinic_settings")
    .update(updateData)
    .eq("clinic_id", clinicId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 200 });
}

