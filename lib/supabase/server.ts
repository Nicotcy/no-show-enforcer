import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

type CookieToSet = { name: string; value: string; options?: any };

function mustEnv(name: string) {
  const v =
    process.env[name] ||
    (name === "NEXT_PUBLIC_SUPABASE_URL" ? process.env.SUPABASE_URL : undefined) ||
    (name === "NEXT_PUBLIC_SUPABASE_ANON_KEY" ? process.env.SUPABASE_ANON_KEY : undefined);

  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export async function supabaseServer() {
  const url = mustEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = mustEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  // En tu Next, cookies() parece async. Lo tratamos así para que compile.
  const cookieStore: any = await cookies();

  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options);
        }
      },
    },
  });
}
