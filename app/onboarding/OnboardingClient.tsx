"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function OnboardingClient() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function runOnboarding() {
    setLoading(true);
    setMsg(null);

    try {
      const res = await fetch("/api/onboarding", { method: "POST" });
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

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <button
        onClick={runOnboarding}
        disabled={loading}
        style={{
          padding: 10,
          borderRadius: 8,
          border: "1px solid #ccc",
          cursor: "pointer",
        }}
      >
        {loading ? "Creando..." : "Crear mi clínica"}
      </button>

      {msg && <p style={{ margin: 0 }}>{msg}</p>}
    </div>
  );
}
