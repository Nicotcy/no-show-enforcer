"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function OnboardingClient() {
  const router = useRouter();

  const [businessName, setBusinessName] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function runOnboarding() {
    setLoading(true);
    setMsg(null);

    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_name: businessName.trim() }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setMsg(data?.error ?? "Error ejecutando onboarding");
        setLoading(false);
        return;
      }

      setMsg("Clínica creada. Entrando...");
      router.refresh();
      router.push("/dashboard");
    } catch (e: any) {
      setMsg(e?.message ?? "Error de red");
      setLoading(false);
    }
  }

  async function logout() {
    setLoading(true);
    setMsg(null);

    await supabase.auth.signOut();

    router.refresh();
    router.push("/login");
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <label style={{ display: "grid", gap: 6 }}>
        Nombre de la clínica
        <input
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          placeholder="Ej: Clínica Torcelly"
          style={{ padding: 10, border: "1px solid #ccc", borderRadius: 8 }}
        />
      </label>

      <button
        onClick={runOnboarding}
        disabled={loading || businessName.trim().l
