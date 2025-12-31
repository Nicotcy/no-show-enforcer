import { NextResponse } from "next/server";
import { getServerContext } from "@/lib/server/context";

// Convert datetime-local (local time) -> UTC string without 'Z' (fits timestamp without tz)
function normalizeStartsAt(input: any) {
  const s = String(input ?? "").trim();
  if (!s) return null;

  // Add seconds if missing
  const withSeconds =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s) ? `${s}:00` : s;

  // Parse as LOCAL time (browser-style), then convert to UTC ISO, then strip Z/ms
  const d = new Date(withSeconds);
  if (isNaN(d.getTime())) return null;

  return d.toISOString().replace(".000Z", "").replace("Z", "");
}

export async function GET() {
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

  const { data, error } = await ctx.supabaseAdmin
    .from("appointments")
    .select("*")
    .eq("clinic_id", ctx.clinicId)
    .order("starts_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ appointments: data ?? [] }, { status: 200 });
}

export async function POST(req: Request) {
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

  const body = await req.json().catch(() => ({} as any));

  const patient_name = String(body.patient_name ?? "").trim();
  const starts_at = normalizeStartsAt(body.starts_at);

  if (!patient_name || !starts_at) {
    return NextResponse.json(
      { error: "Missing patient_name or starts_at" },
      { status: 400 }
    );
  }

  const { data, error } = await ctx.supabaseAdmin
    .from("appointments")
    .insert({
      clinic_id: ctx.clinicId,
      user_id: ctx.user.id,
      patient_name,
      starts_at, // UTC (no Z)
      status: "scheduled",
      no_show_excused: false,
      no_show_fee_charged: false,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json(
      { error: error.message, details: error },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, appointment: data }, { status: 200 });
}
