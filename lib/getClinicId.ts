import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function getClinicIdForUser(userId: string) {
  const { data, error } = await supabase
    .from("clinic_members")
    .select("clinic_id")
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    throw new Error("User is not linked to any clinic");
  }

  return data.clinic_id;
}
