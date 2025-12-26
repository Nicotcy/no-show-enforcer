import { supabaseServer } from "@/lib/supabase/server";

export async function getClinicIdForUser() {
  const supabase = await supabaseServer();

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) return null;

  const { data, error } = await supabase
    .from("clinic_users")
    .select("clinic_id")
    .eq("user_id", userData.user.id)
    .limit(1)
    .single();

  if (error) return null;
  return data?.clinic_id ?? null;
}
