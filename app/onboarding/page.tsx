import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import OnboardingClient from "./OnboardingClient";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

export default async function OnboardingPage() {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("clinic_id")
    .eq("id", user.id)
    .single();

  if (profile?.clinic_id) redirect("/dashboard");

  return (
    <div style={{ padding: 24, maxWidth: 520 }}>
      <h1>Onboarding</h1>
      <p>Tu usuario aún no tiene clínica asociada. Créala para continuar.</p>
      <OnboardingClient />
    </div>
  );
}
