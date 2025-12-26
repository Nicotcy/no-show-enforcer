import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Si ya hay sesión, decide server-side a dónde va:
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("clinic_id")
      .eq("id", user.id)
      .single();

    if (profile?.clinic_id) redirect("/dashboard");
    redirect("/onboarding");
  }

  return (
    <div style={{ padding: 24, maxWidth: 420 }}>
      <h1>Login</h1>
      <LoginForm />
    </div>
  );
}
