import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  { auth: { persistSession: false } }
);

export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");

  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  // Cogemos una clínica cualquiera para poder registrar la ejecución
  const { data: clinic, error: clinicError } = await supabase
    .from("clinics")
    .select("id")
    .limit(1)
    .single();

  if (clinicError || !clinic) {
    return NextResponse.json(
      { error: clinicError?.message ?? "No clinic found" },
      { status: 500 }
    );
  }

  const { error: logError } = await supabase.from("cron_runs").insert({
    clinic_id: clinic.id,
    job: "no-shows",
    candidate_count: 0,
    updated_count: 0,
    details: { note: "debug run", now: now.toISOString() },
    ran_at: now.toISOString(),
  });

  return NextResponse.json(
    {
      step: "done",
      now: now.toISOString(),
      candidateCount: 0,
      updatedCount: 0,
      updatedIds: [],
      logError: logError?.message ?? null,
    },
    { status: 200 }
  );
}
