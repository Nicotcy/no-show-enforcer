import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getClinicIdForUser } from "@/lib/getClinicId";

export const runtime = "nodejs";

// Cliente ADMIN (service role) para leer/escribir clinic_settings sin pelearte con RLS.
// Ojo: SOLO en servidor (route handler). Nunca en el frontend.
const admin = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } }
);

// Defaults por si no existe fila en clinic_settings
const DEFAULT_SETTINGS = {
  grace_minutes: 15,
  late_cancel_window_minutes: 1440,
  auto_charge_enabled: false,
  no_show_fee_cents: 0,
  currency: "EUR",
};

async function resolveClinicId(req: Request) {
  // 1) si viene por query, lo aceptamos (útil para debug / admin)
  const url = new URL(req.url);
  const clinicIdFromQuery = url.searchParams.get("clinic_id");
  if (clinicIdFromQuery) return clinicIdFromQuery;

  // 2) si no viene, lo sacamos del usuario logueado
  // OJO: asumo que tu getClinicIdForUser ya mira la sesión/cookies.
  // Si tu función necesita el req, cámbialo a: getClinicIdForUser(req)
  const clinicId = await getClinicIdForUser();
  return clinicId;
}

export async function GET(req: Request) {
  const clinicId = await resolveClinicId(req);

  if (!clinicId) {
    return NextResponse.json(
      { error: "Unauthorized or clinic not found for user" },
      { status: 401 }
    );
  }

  // Intentamos leer settings
  const { data, error } = await admin
    .from("clinic_settings")
    .select("*")
    .eq("clinic_id", clinicId)
    .single();

  // Si no existe fila, la creamos con defaults (esto te evita muchos dolores)
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
  if (body.grace_minutes !== undefined) updateData.grace_minutes = body.grace_minutes;
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
