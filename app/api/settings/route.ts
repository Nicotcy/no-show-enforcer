import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getClinicIdForUser } from "@/lib/getClinicId";

export const runtime = "nodejs";

export async function GET() {
  const clinicId = await getClinicIdForUser();
  if (!clinicId) {
    return NextResponse.json(
      { error: "Unauthorized or clinic not found for user" },
      { status: 401 }
    );
  }

  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("clinic_settings")
    .select("*")
    .eq("clinic_id", clinicId)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 200 });
}

export async function PUT(req: Request) {
  const clinicId = await getClinicIdForUser();
  if (!clinicId) {
    return NextResponse.json(
      { error: "Unauthorized or clinic not found for user" },
      { status: 401 }
    );
  }

  const supabase = await supabaseServer();
  const body = await req.json();

  const updateData: Record<string, any> = {};
  if (body.grace_minutes !== undefined) updateData.grace_minutes = body.grace_minutes;
  if (body.late_cancel_window_minutes !== undefined) updateData.late_cancel_window_minutes = body.late_cancel_window_minutes;
  if (body.auto_charge_enabled !== undefined) updateData.auto_charge_enabled = body.auto_charge_enabled;
  if (body.no_show_fee_cents !== undefined) updateData.no_show_fee_cents = body.no_show_fee_cents;
  if (body.currency !== undefined) updateData.currency = body.currency;
  updateData.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("clinic_settings")
    .update(updateData)
    .eq("clinic_id", clinicId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 200 });
}
