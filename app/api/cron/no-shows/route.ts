import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
        { error: "Missing Supabase env vars" },
        { status: 500 }
      );
    }

    // ✅ node-fetch puede venir como { default: fn } o como fn
    const nodeFetchMod = require("node-fetch");
    const nodeFetch =
      (nodeFetchMod && nodeFetchMod.default) ? nodeFetchMod.default : nodeFetchMod;

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      global: {
        fetch: nodeFetch,
      },
    });

    const nowIso = new Date().toISOString();

    const { count: candidateCount, error: countError } = await supabase
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("status", "scheduled")
      .lt("starts_at", nowIso);

if (countError) {
  return NextResponse.json(
    {
      step: "count-error",
      errorMessage: countError.message,
      errorDetails: (countError as any).details,
      errorHint: (countError as any).hint,
      errorCode: (countError as any).code,
      raw: countError,
    },
    { status: 500 }
  );
}


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

    return NextResponse.json({
      step: "done",
      now: nowIso,
      candidateCount: candidateCount ?? 0,
      updatedCount: updatedRows?.length ?? 0,
      updatedIds: (updatedRows ?? []).map((r: any) => r.id),
    });
  } catch (e: any) {
    return NextResponse.json(
      { step: "crash", error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
