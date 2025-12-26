import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

async function getContext() {
  const cookieStore = await cookies();

  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );

  const { data: { user } } = await supabaseAuth.auth.getUser();
  if (!user) return null;

  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("clinic_id")
    .eq("id", user.id)
    .single();

  if (!profile?.clinic_id) return null;

  return { user, clinic_id: profile.clinic_id, supabaseAdmin };
}

/* ---------- GET: list appointments ---------- */
export async function GET() {
  const ctx = await getContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await ctx.supabaseAdmin
    .from("appointments")
    .select("*")
    .eq("clinic_id", ctx.clinic_id)
    .order("starts_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 200 });
}

/* ---------- POST: create appointment ---------- */
export async function POST(req: Request) {
  const ctx = await getContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();

  const patient_name = String(body.patient_name ?? "").trim();
  const starts_at = body.starts_at;

  if (!patient_name || !starts_at) {
    return NextResponse.json(
      { error: "Missing patient_name or starts_at" },
      { status: 400 }
    );
  }

  const { error } = await ctx.supabaseAdmin
    .from("appointments")
    .insert({
      clinic_id: ctx.clinic_id,
      user_id: ctx.user.id,
      patient_name,
      starts_at,
      status: "scheduled",
      no_show_excused: false,
      no_show_fee_charged: false,
    });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
