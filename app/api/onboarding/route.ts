import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export const runtime = "nodejs";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

function supabaseServer(req: NextRequest) {
  const res = NextResponse.next();

  const supabase = createServerClient(
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

  return { supabase, res };
}

export async function POST(req: NextRequest) {
  const { supabase, res } = supabaseServer(req);

  // 1) auth
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = userData.user;

  // 2) body
  let body: any = {};
  try {
    body = await req.json();
  } catch (_) {}

  const businessName = (body?.business_name ?? "").toString().trim();
  const timezone = (body?.timezone ?? "Europe/Madrid").toString();
  const currency = (body?.currency ?? "EUR").toString();

  if (!businessName) {
    return NextResponse.json({ error: "Missing business_name" }, { status: 400 });
  }

  // 3) upsert profile
  const { error: profileErr } = await supabase.from("profiles").upsert({
    id: user.id,
    business_name: businessName,
    timezone,
    currency,
  });

  if (profileErr) {
    return NextResponse.json({ error: profileErr.message }, { status: 500 });
  }

  // 4) create clinic
  const { data: clinic, error: clinicErr } = await supabase
    .from("clinics")
    .insert({
      name: businessName,
      owner_user_id: user.id,
    })
    .select("id")
    .single();

  if (clinicErr || !clinic?.id) {
    return NextResponse.json(
      { error: clinicErr?.message ?? "Failed creating clinic" },
      { status: 500 }
    );
  }

  const clinicId = clinic.id as string;

  // 5) membership (owner/admin)
  const { error: memberErr } = await supabase.from("clinic_memberships").insert({
    clinic_id: clinicId,
    user_id: user.id,
    role: "owner",
  });

  if (memberErr) {
    return NextResponse.json({ error: memberErr.message }, { status: 500 });
  }

  // 6) default settings
  const { error: settingsErr } = await supabase.from("clinic_settings").insert({
    clinic_id: clinicId,
    grace_minutes: 10,
    late_cancel_window_minutes: 24 * 60,
    auto_charge_enabled: false,
    no_show_fee_cents: 0,
    currency,
  });

  if (settingsErr) {
    return NextResponse.json({ error: settingsErr.message }, { status: 500 });
  }

  // devolvemos también el res por si supabase ha querido setear cookies
  // (en este flujo normalmente no, pero queda correcto)
  res.headers.set("content-type", "application/json");
  return new NextResponse(JSON.stringify({ ok: true, clinic_id: clinicId }), {
    status: 200,
    headers: res.headers,
  });
}
