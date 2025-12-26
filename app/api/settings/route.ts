import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export const runtime = "nodejs";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

function makeSupabaseServerClient(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  const cookiesToSet: CookieToSet[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(c: CookieToSet[]) {
          cookiesToSet.push(...c);
        },
      },
    }
  );

  return { supabase, cookiesToSet };
}

async function getClinicIdFromSession(supabase: any): Promise<string | null> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return null;

  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("clinic_id")
    .eq("id", user.id)
    .single();

  if (profErr) return null;
  return profile?.clinic_id ?? null;
}

export async function GET() {
  const cookieStore = await cookies();
  const { supabase, cookiesToSet } = makeSupabaseServerClient(cookieStore);

  const clinicId = await getClinicIdFromSession(supabase);

  if (!clinicId) {
    const res = NextResponse.json(
      { error: "Unauthorized or clinic not found for user" },
      { status: 401 }
    );
    for (const { name, value, options } of cookiesToSet) {
      res.cookies.set(name, value, options);
    }
    return res;
  }

  const { data, error } = await supabase
    .from("clinic_settings")
    .select("*")
    .eq("clinic_id", clinicId)
    .single();

  if (error) {
    const res = NextResponse.json({ error: error.message }, { status: 500 });
    for (const { name, value, options } of cookiesToSet) {
      res.cookies.set(name, value, options);
    }
    return res;
  }

  const res = NextResponse.json(data, { status: 200 });
  for (const { name, value, options } of cookiesToSet) {
    res.cookies.set(name, value, options);
  }
  return res;
}

export async function PATCH(req: Request) {
  const cookieStore = await cookies();
  const { supabase, cookiesToSet } = makeSupabaseServerClient(cookieStore);

  const clinicId = await getClinicIdFromSession(supabase);

  if (!clinicId) {
    const res = NextResponse.json(
      { error: "Unauthorized or clinic not found for user" },
      { status: 401 }
    );
    for (const { name, value, options } of cookiesToSet) {
      res.cookies.set(name, value, options);
    }
    return res;
  }

  const body = await req.json().catch(() => ({} as any));

  const updateData: Record<string, any> = {};
  if (body.grace_minutes !== undefined) updateData.grace_minutes = Number(body.grace_minutes);
  if (body.late_cancel_window_minutes !== undefined)
    updateData.late_cancel_window_minutes = Number(body.late_cancel_window_minutes);
  if (body.auto_charge_enabled !== undefined)
    updateData.auto_charge_enabled = Boolean(body.auto_charge_enabled);
  if (body.no_show_fee_cents !== undefined)
    updateData.no_show_fee_cents = Number(body.no_show_fee_cents);
  if (body.currency !== undefined) updateData.currency = String(body.currency);

  updateData.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("clinic_settings")
    .update(updateData)
    .eq("clinic_id", clinicId)
    .select()
    .single();

  if (error) {
    const res = NextResponse.json({ error: error.message }, { status: 500 });
    for (const { name, value, options } of cookiesToSet) {
      res.cookies.set(name, value, options);
    }
    return res;
  }

  const res = NextResponse.json(data, { status: 200 });
  for (const { name, value, options } of cookiesToSet) {
    res.cookies.set(name, value, options);
  }
  return res;
}
