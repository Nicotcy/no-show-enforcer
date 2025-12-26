import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } }
);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const update: any = {};

  // status updates
  if (body.status) update.status = body.status;

  // check-in
  if (body.checked_in === true) {
    update.checked_in_at = new Date().toISOString();
    // optional: if checked in, clear no_show status if it was set
    if (update.status === undefined) update.status = "checked_in";
  }

  // cancel
  if (body.cancel === true) {
    // your schema has BOTH cancelled_at and canceled_at (we set both to be safe)
    const now = new Date().toISOString();
    update.status = "canceled";
    update.cancelled_at = now;
    update.canceled_at = now;
  }

  // excuse
  if (body.no_show_excused !== undefined)
    update.no_show_excused = body.no_show_excused;

  if (body.no_show_excuse_reason !== undefined)
    update.no_show_excuse_reason = body.no_show_excuse_reason;

  const { data, error } = await supabase
    .from("appointments")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, appointment: data }, { status: 200 });
}
