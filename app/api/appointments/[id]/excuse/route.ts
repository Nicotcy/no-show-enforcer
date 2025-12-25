import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  {
    auth: {
      persistSession: false,
    },
  },
);

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  const authHeader = req.headers.get("authorization") || "";
  const expectedHeader = `Bearer ${process.env.CRON_SECRET}`;
  if ((!secret || secret !== process.env.CRON_SECRET) && authHeader !== expectedHeader) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  const appointmentId = params.id;
  let reason: string | null = null;
  try {
    const body = await req.json();
    reason = body?.reason ?? null;
  } catch (_) {
    reason = null;
  }

  const { data, error } = await supabase
    .from("appointments")
    .update({ no_show_excused: true, no_show_excuse_reason: reason })
    .eq("id", appointmentId)
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json(data, { status: 200 });
}
