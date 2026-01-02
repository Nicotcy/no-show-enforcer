import { NextResponse } from "next/server";
import { getServerContext } from "@/lib/server/context";

export const runtime = "nodejs";

type View = "pending" | "processing" | "failed" | "charged" | "all";

export async function GET(req: Request) {
  let ctx;
  try {
    ctx = await getServerContext();
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to load context" },
      { status: 500 }
    );
  }

  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const view = (url.searchParams.get("view") || "pending") as View;

  // Base query: solo mi clínica
  let q = ctx.supabaseAdmin
    .from("appointments")
    .select(
      "id, patient_name, starts_at, status, no_show_excused, no_show_fee_pending, no_show_fee_charged, no_show_fee_processing_at, no_show_fee_attempt_count, no_show_fee_last_error"
    )
    .eq("clinic_id", ctx.clinicId)
    .order("starts_at", { ascending: false })
    .limit(200);

  // Filtrado por “vista” (sin inventar modelo nuevo)
  if (view === "charged") {
    q = q.eq("no_show_fee_charged", true);
  } else if (view === "processing") {
    q = q
      .eq("no_show_fee_pending", true)
      .eq("no_show_fee_charged", false)
      .not("no_show_fee_processing_at", "is", null);
  } else if (view === "failed") {
    q = q
      .eq("no_show_fee_pending", true)
      .eq("no_show_fee_charged", false)
      .is("no_show_fee_processing_at", null)
      .not("no_show_fee_last_error", "is", null);
  } else if (view === "pending") {
    q = q
      .eq("no_show_fee_pending", true)
      .eq("no_show_fee_charged", false)
      .is("no_show_fee_processing_at", null)
      .is("no_show_fee_last_error", null);
  } else {
    // all: nada extra
  }

  const { data, error } = await q;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ appointments: data ?? [] }, { status: 200 });
}
