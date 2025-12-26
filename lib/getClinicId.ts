import { supabaseServer } from "@/lib/supabase/server";

export async function getClinicIdForUser(userId?: string) {
  const supabase = await supabaseServer();

  // Si no te pasan userId, lo sacas de la sesión
  let uid = userId;
  if (!uid) {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) return null;
    uid = data.user.id;
  }

  const { data, error } = await supabase
    .from("clinic_users")
    .select("clinic_id")
    .eq("user_id", uid)
    .limit(1)
    .single();

  if (error) return null;
  return data?.clinic_id ?? null;
}
