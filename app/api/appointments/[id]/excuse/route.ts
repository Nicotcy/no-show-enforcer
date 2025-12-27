import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

export const runtime = "nodejs";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

function normalizeReason(input: any): string | null {
  if (typeof input !== "string") return null;
  const t = input.trim();
  return t.length ? t : null;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: appointmentId } = await params;

  // Supabase SSR client (auth from cookies)
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
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

  // 1) must be logged in
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2) get clinic_id from profile
  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("clinic_id")
    .eq("id", user.id)
    .maybeSingle();

  if (profErr) {
    return NextResponse.json(
      { error: `Failed to read profile: ${profErr.message}` },
      { status: 500 }
    );
  }

  const clinicId = profile?.clinic_id ?? null;
  if (!clinicId) {
    return NextResponse.json(
      { error: "No clinic linked to this user." },
      { status: 400 }
    );
  }

  // 3) check appointment belongs to your clinic
  const { data: appt, error: apptErr } = await supabase
    .from("appointments")
    .select("id, clinic_id, status")
    .eq("id", appointmentId)
    .maybeSingle();

  if (apptErr) {
    return NextResponse.json(
      { error: `Failed to read appointment: ${apptErr.message}` },
      { status: 500 }
    );
  }

  if (!appt || appt.clinic_id !== clinicId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 4) read body reason
  let reason: string | null = null;
  try {
    const body = await req.json();
    reason = normalizeReason(body?.reason);
  } catch {
    reason = null;
  }

  // 5) update (scoped to clinic for safety)
  const { data: updated, error: updErr } = await supabase
    .from("appointments")
    .update({
      no_show_excused: true,
      no_show_excuse_reason: reason,
    })
    .eq("id", appointmentId)
    .eq("clinic_id", clinicId)
    .select("id, no_show_excused, no_show_excuse_reason, status")
    .maybeSingle();

  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, appointment: updated }, { status: 200 });
}
