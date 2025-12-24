import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const secret = searchParams.get("secret");

    // 1) Seguridad: solo corre si viene el secret correcto
    if (!secret || secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2) Variables de entorno (servidor)
    const supabaseUrl =
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;

    const serviceRoleKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        {
          step: "env-missing",
          error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
          debug: {
            hasSUPABASE_URL: !!process.env.SUPABASE_URL,
            hasNEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
            hasSERVICE_ROLE: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
            hasNEXT_PUBLIC_SERVICE_ROLE:
              !!process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY,
          },
        },
        { status: 500 }
      );
    }

    // ✅ TEST DIRECTO con fetch (sin supabase-js)
    try {
      const r = await fetch(`${supabaseUrl}/rest/v1/`, {
        method: "GET",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      });

      const text = await r.text();

      return NextResponse.json(
        {
          step: "supabase-ping",
          ok: r.ok,
          status: r.status,
          bodyPreview: text.slice(0, 200),
        },
        { status: 200 }
      );
    } catch (e: any) {
      return NextResponse.json(
        {
          step: "supabase-ping-failed",
          error: e?.message ?? String(e),
        },
        { status: 500 }
      );
    }
  } catch (e: any) {
    return NextResponse.json(
      { step: "crash", error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
