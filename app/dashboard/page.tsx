"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type ClinicSettings = {
  clinic_id: string;
  grace_minutes: number;
  late_cancel_window_minutes?: number;
  auto_charge_enabled?: boolean;
  no_show_fee_cents?: number;
  currency?: string;
};

export default function DashboardRouterPage() {
  const router = useRouter();
  const [status, setStatus] = useState<string>("Cargando...");

  useEffect(() => {
    (async () => {
      setStatus("Comprobando sesión...");

      const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr) {
        setStatus("Error leyendo sesión");
        return;
      }

      if (!sessionData.session) {
        router.replace("/"); // login
        return;
      }

      setStatus("Comprobando clínica...");

      try {
        // OJO: esto llama a TU API route (server) que resuelve clinic por cookies/sesión
        const res = await fetch("/api/settings", { method: "GET" });

        if (res.status === 401) {
          router.replace("/"); // no autorizado
          return;
        }

        if (res.status === 404) {
          router.replace("/onboarding"); // no tiene clínica aún
          return;
        }

        if (!res.ok) {
          const txt = await res.text();
          setStatus(`Error /api/settings: ${res.status} ${txt}`);
          return;
        }

        const settings = (await res.json()) as ClinicSettings;

        if (!settings?.clinic_id) {
          router.replace("/onboarding");
          return;
        }

        // Si tienes un dashboard real, manda ahí. Si no, a settings.
        router.replace("/settings");
      } catch (e: any) {
        setStatus(e?.message ? `Error: ${e.message}` : "Error desconocido");
      }
    })();
  }, [router]);

  return (
    <div style={{ maxWidth: 520, margin: "40px auto", padding: 16 }}>
      <h1>Dashboard</h1>
      <p>{status}</p>
    </div>
  );
}
