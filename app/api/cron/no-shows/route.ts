import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // 3) “Ahora” (en formato que entiende la DB)
    const nowIso = new Date().toISOString();

    // 4) Primero contamos cuántas serían candidatas
    const { count: candidateCount, error: countError } = await supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("status", "scheduled")
      .lt("starts_at", nowIso);

    if (countError) {
      return NextResponse.json(
        { step: "count-error", error: countError.message },
        { status: 500 }
      );
    }

    // 5) Luego actualizamos esas citas a no_show
    const { data: updatedRows, error: updateError } = await supabase
      .from("appointments")
      .update({
        status: "no_show",
        no_show_fee_charged: false,
      })
      .eq("status", "scheduled")
      .lt("starts_at", nowIso)
      .select("id");

    if (updateError) {
      return NextResponse.json(
        { step: "update-error", error: updateError.message },
        { status: 500 }
      );
    }

    const updatedIds = (updatedRows ?? []).map((r) => r.id);

    return NextResponse.json({
      step: "done",
      now: nowIso,
      candidateCount: candidateCount ?? 0,
      updatedCount: updatedIds.length,
      updatedIds,
    });
  } catch (e: any) {
    return NextResponse.json(
      { step: "crash", error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
