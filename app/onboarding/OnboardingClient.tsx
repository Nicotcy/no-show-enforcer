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
