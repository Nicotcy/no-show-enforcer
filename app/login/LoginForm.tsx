"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    setInfoMsg(null);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (error) {
      setErrorMsg(error.message);
      return;
    }

    router.refresh();
    router.push("/login");
  }

  async function signUp() {
    setLoading(true);
    setErrorMsg(null);
    setInfoMsg(null);

    const { error } = await supabase.auth.signUp({
      email,
      password,
      // If email confirmations are enabled in Supabase, the user must confirm via email.
    });

    setLoading(false);

    if (error) {
      setErrorMsg(error.message);
      return;
    }

    setInfoMsg(
      "Account created. If email confirmation is enabled, please check your inbox."
    );

    // If Supabase logs them in immediately (depending on your settings),
    // this will take them to onboarding/dashboard via server logic.
    router.refresh();
    router.push("/login");
  }

  return (
    <form onSubmit={signIn} style={{ display: "grid", gap: 12 }}>
      <label style={{ display: "grid", gap: 6 }}>
        Email
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          required
          style={{ padding: 10, border: "1px solid #ccc", borderRadius: 8 }}
        />
      </label>

      <label style={{ display: "grid", gap: 6 }}>
        Password
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          required
          style={{ padding: 10, border: "1px solid #ccc", borderRadius: 8 }}
        />
      </label>

      <button
        type="submit"
        disabled={loading}
        style={{
          padding: 10,
          borderRadius: 8,
          border: "1px solid #ccc",
          cursor: "pointer",
        }}
      >
        {loading ? "Signing in..." : "Sign in"}
      </button>

      <button
        type="button"
        onClick={signUp}
        disabled={loading}
        style={{
          padding: 10,
          borderRadius: 8,
          border: "1px solid #ccc",
          cursor: "pointer",
        }}
      >
        {loading ? "Creating..." : "Create account"}
      </button>

      {errorMsg && <p style={{ color: "crimson", margin: 0 }}>{errorMsg}</p>}
      {infoMsg && <p style={{ margin: 0 }}>{infoMsg}</p>}
    </form>
  );
}
