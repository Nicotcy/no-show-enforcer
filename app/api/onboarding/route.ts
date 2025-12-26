import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export const runtime = "nodejs";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

function makeSupabaseServerClient(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  // En Route Handlers no podemos mutar cookieStore directamente.
  // Acumulamos cookies y las seteamos en la respuesta final.
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

export async function POST(req: Request) {
  const cookieStore = await cookies();
  const { supabase, cookiesToSet } = makeSupabaseServerClient(cookieStore);

  try {
    // 1) Usuario autenticado (por cookies de Supabase)
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2) Body
    const body = await req.json().catch(() => ({} as any));
    const businessName = (body?.business_name ?? "").toString().trim();
    const timezone = (body?.timezone ?? "Europe/Madrid").toString().trim();
    const currency = (body?.currency ?? "EUR").toString().trim();

    if (!businessName) {
      return NextResponse.json({ error: "Missing business_name" }, { status: 400 });
    }

    // 3) ¿Ya tiene clínica en profiles?
    const { data: existingProfile, error: profReadErr } = await supabase
      .from("profiles")
      .select("clinic_id")
      .eq("id", user.id)
      .single();

    if (profReadErr) {
      return NextResponse.json({ error: profReadErr.message }, { status: 500 });
    }

    let clinicId: string | null = existingProfile?.clinic_id ?? null;

    // 4) Si NO hay clínica, la creamos
    if (!clinicId) {
      const { data: clinic, error: clinicErr } = await supabase
        .from("clinics")
        .insert({ name: businessName })
        .select("id")
        .single();

      if (clinicErr || !clinic?.id) {
        return NextResponse.json(
          { error: clinicErr?.message ?? "Failed creating clinic" },
          { status: 500 }
        );
      }

      clinicId = clinic.id as string;

      // 5) Enlazar profiles.clinic_id
      const { error: profUpdateErr } = await supabase
        .from("profiles")
        .update({
          clinic_id: clinicId,
          business_name: businessName,
          timezone,
          currency,
        })
        .eq("id", user.id);

      if (profUpdateErr) {
        return NextResponse.json({ error: profUpdateErr.message }, { status: 500 });
      }

      // 6) Crear settings por defecto si tu tabla clinic_settings existe
      // (si ya lo tienes por trigger o algo, esto simplemente no hará daño si hay unique clinic_id)
      await supabase.from("clinic_settings").upsert(
        {
          clinic_id: clinicId,
          grace_minutes: 10,
          late_cancel_window_minutes: 24 * 60,
          auto_charge_enabled: false,
          no_show_fee_cents: 0,
          currency,
        },
        { onConflict: "clinic_id" }
      );
    } else {
      // Si ya existe clínica, al menos aseguramos datos básicos del profile
      await supabase
        .from("profiles")
        .update({
          business_name: businessName,
          timezone,
          currency,
        })
        .eq("id", user.id);
    }

    // 7) Respuesta + set cookies si Supabase quiso rotarlas
    const res = NextResponse.json({ ok: true, clinic_id: clinicId }, { status: 200 });
    for (const { name, value, options } of cookiesToSet) {
      res.cookies.set(name, value, options);
    }
    return res;
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
