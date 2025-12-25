import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabaseClient"; // usa tu client normal (anon) con cookies/sesión
import { getClinicIdForUser } from "@/lib/getClinicId";

export async function GET(req: Request) {
  const supabase = createClient();

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const clinicId = await getClinicIdForUser(user.id);

  const { data, error } = await supabase
    .from("clinic_settings")
    .select("grace_minutes")
    .eq("clinic_id", clinicId)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ clinicId, grace_minutes: data.grace_minutes });
}

export async function PATCH(req: Request) {
  const supabase = createClient();

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const clinicId = await getClinicIdForUser(user.id);

  const body = await req.json();
  const graceMinutes = Number(body.grace_minutes);

  if (!Number.isFinite(graceMinutes) || graceMinutes < 0 || graceMinutes > 180) {
    return NextResponse.json({ error: "Invalid grace_minutes" }, { status: 400 });
  }

  const { error } = await supabase
    .from("clinic_settings")
    .update({ grace_minutes: graceMinutes })
    .eq("clinic_id", clinicId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, clinicId, grace_minutes: graceMinutes });
}
