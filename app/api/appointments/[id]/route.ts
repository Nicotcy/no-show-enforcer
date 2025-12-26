import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const body = await req.json();

  const update: any = {};

  if (body.status) update.status = body.status;
  if (body.no_show_excused !== undefined)
    update.no_show_excused = body.no_show_excused;
  if (body.no_show_excuse_reason)
    update.no_show_excuse_reason = body.no_show_excuse_reason;

  const { error } = await supabaseAdmin
    .from("appointments")
    .update(update)
    .eq("id", params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
