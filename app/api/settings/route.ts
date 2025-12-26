import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const admin = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } }
);

function authClient(req: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll() {
          // aquí no necesitamos setear cookies
        },
      },
    }
  );
}

async function getClinicIdFromSession(req: NextRequest) {
  const supabase = authClient(req);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return null;

  const userId = data.user.id;

  const { data: profile, error: profErr } = await admin
    .from("profiles")
    .select("clinic_id")
    .eq("id", userId)
    .maybeSingle();

  if (profErr) return null;
  return profile?.clinic_id ?? null;
}

export async function GET(req: NextRequest) {
  const clinicId = await getClinicIdFromSession(req);
  if (!clinicId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await admin
    .from("clinic_settings")
    .select("*")
    .eq("clinic_id", clinicId)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 200 });
}

export async function PUT(req: NextRequest) {
  const clinicId = await getClinicIdFromSession(req);
  if (!clinicId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();

  const updateData: any = {};
  if (body.grace_minutes !== undefined) updateData.grace_minutes = body.grace_minutes;
  if (body.late_cancel_window_minutes !== undefined) updateData.late_cancel_window_minutes = body.late_cancel_window_minutes;
  if (body.auto_charge_enabled !== undefined) updateData.auto_charge_enabled = body.auto_charge_enabled;
  if (body.no_show_fee_cents !== undefined) updateData.no_show_fee_cents = body.no_show_fee_cents;
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
