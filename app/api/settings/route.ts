import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } }
);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const clinicId = url.searchParams.get("clinic_id");
  if (!clinicId) {
    return NextResponse.json({ error: "Missing clinic_id" }, { status: 400 });
  }
  const { data, error } = await supabase
    .from("clinic_settings")
    .select("*")
    .eq("clinic_id", clinicId)
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 200 });
}

export async function PUT(req: Request) {
  const url = new URL(req.url);
  const clinicId = url.searchParams.get("clinic_id");
  if (!clinicId) {
    return NextResponse.json({ error: "Missing clinic_id" }, { status: 400 });
  }
  const body = await req.json();
  const updateData: any = {};
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
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 200 });
}
