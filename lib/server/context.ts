import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

export type ServerContext = {
  user: { id: string; email?: string | null };
  clinicId: string;
  supabaseAdmin: SupabaseClient;
};

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

/**
 * Returns the authenticated user's clinic context.
 * - Auth is read from cookies (Supabase SSR)
 * - clinicId is read from profiles via service role (avoids RLS surprises)
 */
export async function getServerContext(): Promise<ServerContext | null> {
  const cookieStore = await cookies();

  const supabaseAuth = createServerClient(
    mustEnv("NEXT_PUBLIC_SUPABASE_URL"),
    mustEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
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

  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();

  if (!user) return null;

  const supabaseAdmin = createClient(
    mustEnv("SUPABASE_URL"),
    mustEnv("SUPABASE_SERVICE_ROLE_KEY")
  );

  // profiles is 1 row per user, but we still avoid .single() to prevent "0 rows" errors.
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .select("clinic_id")
    .eq("id", user.id)
    .maybeSingle();

  if (profileErr) {
    throw new Error(`Failed to read profile: ${profileErr.message}`);
  }

  const clinicId = profile?.clinic_id ?? null;
  if (!clinicId) return null;

  return {
    user: { id: user.id, email: user.email },
    clinicId,
    supabaseAdmin,
  };
}
