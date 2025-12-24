import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const secret = searchParams.get("secret");

    if (!secret || secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabaseUrl =
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;

    const serviceRoleKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { step: "env-missing", hasUrl: !!supabaseUrl, hasKey: !!serviceRoleKey },
        { status: 500 }
      );
    }

    const nowIso = new Date().toISOString();

    // 👇 Consulta REST directa a la tabla (para ver error real)
    const url =
      `${supabaseUrl}/rest/v1/appointments` +
      `?select=id` +
      `&status=eq.scheduled` +
      `&starts_at=lt.${encodeURIComponent(nowIso)}`;

    try {
      const r = await fetch(url, {
        method: "GET",
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      });

      const text = await r.text();

      return NextResponse.json(
        {
          step: "rest-query",
          urlPreview: url.slice(0, 120),
          ok: r.ok,
          status: r.status,
          body: text.slice(0, 2000),
        },
        { status: 200 }
      );
    } catch (e: any) {
      return NextResponse.json(
        { step: "rest-fetch-failed", error: e?.message ?? String(e) },
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

