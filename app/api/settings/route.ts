import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function getSupabaseServerClient() {
  const cookieStore = await cookies();
  const cookiesToSet: CookieToSet[] = [];

  const supabase = createServerClient(
    getEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(c) {
          // En route handlers no podemos mutar el cookieStore directamente:
          // acumulamos y los seteamos en la respuesta final.
          cookiesToSet.push(...c);
        },
      },
    }
  );

  return { supabase, cookiesToSet };
}

async function withCookies<T>(
  result: { body: T; status: number },
  cookiesToSet: CookieToSet[]
) {
  const res = NextResponse.json(result.body, { status: result.status });
  for (const { name, value, options } of cookiesToSet) {
    res.cookies.set(name, value, options);
  }
  return res;
}

async function resolveClinicIdForAuthedUser(supabase: any) {
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData?.user) return { userId: null, clinicId: null };

  const userId = authData.user.id;

  // Asumimos que onboarding guarda clinic_id en profiles
  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("clinic_id")
    .eq("id", userId)
    .maybeSingle();

  if (profErr || !profile?.clinic_id) return { userId, clinicId: null };

  return { userId, clinicId: profile.clinic_id as string };
}

export async function GET() {
  const { supabase, cookiesToSet } = await getSupabaseServerClient();

  const { clinicId } = await resolveClinicIdForAuthedUser(supabase);
  if (!clinicId) {
    return withCookies(
      { body: { error: "Unauthorized or clinic not found for user" }, status: 401 },
      cookiesToSet
    );
  }

  const { data, error } = await supabase
    .from("clinic_settings")
    .select("*")
    .eq("clinic_id", clinicId)
    .single();

  if (error) {
    return withCookies(
      { body: { error: error.message }, status: 500 },
      cookiesToSet
    );
  }

  return withCookies({ body: data, status: 200 }, cookiesToSet);
}

// usa PATCH (tu settings/page.tsx lo usa)
export async function PATCH(req: Request) {
  const { supabase, cookiesToSet } = await getSupabaseServerClient();

  const { clinicId } = await resolveClinicIdForAuthedUser(supabase);
  if (!clinicId) {
    return withCookies(
      { body: { error: "Unauthorized or clinic not found for user" }, status: 401 },
      cookiesToSet
    );
  }

  const body = await req.json();

  const updateData: Record<string, any> = {};
  if (body.grace_minutes !== undefined) updateData.grace_minutes = body.grace_minutes;
  if (body.late_cancel_window_minutes !== undefined)
    updateData.late_cancel_window_minutes = body.late_cancel_window_minutes;
  if (body.auto_charge_enabled !== undefined)
    updateData.auto_charge_enabled = body.auto_charge_enabled;
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
    return withCookies(
      { body: { error: error.message }, status: 500 },
      cookiesToSet
    );
  }

  return withCookies({ body: data, status: 200 }, cookiesToSet);
}
