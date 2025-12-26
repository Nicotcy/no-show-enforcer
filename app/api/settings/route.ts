import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { getClinicIdForUser } from "@/lib/getClinicId";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

function makeSupabase(req: NextRequest, res: NextResponse) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          for (const { name, value, options } of cookiesToSet) {
            res.cookies.set(name, value, options);
          }
        },
      },
    }
  );
}

export async function GET(req: NextRequest) {
  const res = NextResponse.next();
  const supabase = makeSupabase(req, res);

  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // IMPORTANTÍSIMO: tu función antes daba guerra por la firma.
  // Según tus errores: getClinicIdForUser NO acepta argumentos.
  // Así que la llamamos sin nada.
  const clinicId = await getClinicIdForUser();
  if (!clinicId) {
    return NextResponse.json(
      { error: "Clinic not found for user" },
      { status: 404 }
    );
  }

  const { data: settings, error: sErr } = await supabase
    .from("clinic_settings")
    .select("*")
    .eq("clinic_id", clinicId)
    .single();

  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });

  const out = NextResponse.json(settings, { status: 200 });
  // copiamos cookies potencialmente refrescadas
  for (const c of res.cookies.getAll()) out.cookies.set(c);
  return out;
}

export async function PUT(req: NextRequest) {
  const res = NextResponse.next();
  const supabase = makeSupabase(req, res);

  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clinicId = await getClinicIdForUser();
  if (!clinicId) {
    return NextResponse.json(
      { error: "Clinic not found for user" },
      { status: 404 }
    );
  }

  const body = await req.json();

  const updateData: Record<string, any> = {};
  if (body.grace_minutes !== undefined) updateData.grace_minutes = body.grace_minutes;
  if (body.late_cancel_window_minutes !== undefined) updateData.late_cancel_window_minutes = body.late_cancel_window_minutes;
  if (body.auto_charge_enabled !== undefined) updateData.auto_charge_enabled = body.auto_charge_enabled;
  if (body.no_show_fee_cents !== undefined) updateData.no_show_fee_cents = body.no_show_fee_cents;
  if (body.currency !== undefined) updateData.currency = body.currency;
  updateData.updated_at = new Date().toISOString();

  const { data: updated, error: uErr } = await supabase
    .from("clinic_settings")
    .update(updateData)
    .eq("clinic_id", clinicId)
    .select()
    .single();

  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

  const out = NextResponse.json(updated, { status: 200 });
  for (const c of res.cookies.getAll()) out.cookies.set(c);
  return out;
}
