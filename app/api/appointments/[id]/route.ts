import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  {
    auth: { persistSession: false },
  }
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

  if (body.status) update.status = body.status;
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
