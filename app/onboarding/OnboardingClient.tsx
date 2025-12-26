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

  const [clinicName, setClinicName] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function createClinic() {
    setLoading(true);
    setMsg(null);

    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_name: clinicName.trim() }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setMsg(data?.error ?? "Onboarding failed");
        setLoading(false);
        return;
      }

      setMsg("Clinic created. Redirecting...");
      router.refresh();
      router.push("/dashboard");
    } catch (e: any) {
      setMsg(e?.message ?? "Network error");
      setLoading(false);
    }
  }

  async function signOut() {
    setLoading(true);
    setMsg(null);

    await supabase.auth.signOut();

    router.refresh();
    router.push("/login");
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <label style={{ display: "grid", gap: 6 }}>
        Clinic name
        <input
          value={clinicName}
          onChange={(e) => setClinicName(e.target.value)}
          placeholder="e.g. Torcelly Clinic"
          style={{ padding: 10, border: "1px solid #ccc", borderRadius: 8 }}
        />
      </label>

      <button
        onClick={createClinic}
        disabled={loading || clinicName.trim().length < 2}
        style={{
          padding: 10,
          borderRadius: 8,
          border: "1px solid #ccc",
          cursor: "pointer",
        }}
      >
        {loading ? "Creating..." : "Create my clinic"}
      </button>

      <button
        onClick={signOut}
        disabled={loading}
        style={{
          padding: 10,
          borderRadius: 8,
          border: "1px solid #ccc",
          cursor: "pointer",
        }}
      >
        Sign out
      </button>

      {msg && <p style={{ margin: 0 }}>{msg}</p>}
    </div>
  );
}
