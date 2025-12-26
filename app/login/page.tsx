"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  // 🔑 REDIRECCIÓN AUTOMÁTICA SI YA HAY SESIÓN
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        router.replace("/dashboard");
      }
    })();
  }, [router]);

  async function signUp() {
    setMessage(null);
    const { error } = await supabase.auth.signUp({ email, password });
    setMessage(
      error
        ? error.message
        : "Account created. Check your email if confirmation is required."
    );
  }

  async function signIn() {
    setMessage(null);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setMessage(error.message);
      return;
    }

    // perfil inicial (como ya tenías)
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      await supabase.from("profiles").upsert({
        id: user.id,
        business_name: null,
        timezone: "Europe/Madrid",
        currency: "EUR",
        no_show_fee: 0,
        late_cancel_fee: 0,
        late_cancel_window_hours: 24,
      });
    }

    router.push("/dashboard");
  }

  async function signOut() {
    await supabase.auth.signOut();
    setMessage("Signed out.");
  }

  return (
    <div style={{ maxWidth: 420, margin: "40px auto", padding: 16 }}>
      <h1>Login</h1>

      <input
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{ width: "100%", marginTop: 12, padding: 10 }}
      />

      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={{ width: "100%", marginTop: 12, padding: 10 }}
      />

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button onClick={signUp}>Create account</button>
        <button onClick={signIn}>Sign in</button>
        <button onClick={signOut}>Sign out</button>
      </div>

      {message && <p style={{ marginTop: 12 }}>{message}</p>}
    </div>
  );
}
