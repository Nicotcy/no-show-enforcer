"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type AllowedStatus = "scheduled" | "checked_in" | "late" | "no_show" | "canceled";

type Appointment = {
  id: string;
  patient_name: string;
  starts_at: string;
  status: AllowedStatus | string;
  checked_in_at: string | null;
  no_show_excused: boolean | null;
  no_show_fee_charged: boolean | null;
  no_show_excuse_reason?: string | null;
  cancelled_at?: string | null;
};

function toLocalDisplay(isoOrTs: string) {
  try {
    const d = new Date(isoOrTs);
    if (Number.isNaN(d.getTime())) return isoOrTs;
    return d.toLocaleString();
  } catch {
    return isoOrTs;
  }
}

function datetimeLocalToDb(value: string) {
  if (!value) return "";
  return `${value}:00`;
}

export default function DashboardClient() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(false);

  const [patientName, setPatientName] = useState("");
  const [startsAtLocal, setStartsAtLocal] = useState("");

  const [adding, setAdding] = useState(false); // 👈 NUEVO
  const addCooldownRef = useRef<number | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [pendingById, setPendingById] = useState<Record<string, boolean>>({});

  const dateInputRef = useRef<HTMLInputElement | null>(null);

  function setPending(id: string, pending: boolean) {
    setPendingById((prev) => ({ ...prev, [id]: pending }));
  }

  function patchAppointmentInState(updated: Appointment | null | undefined) {
    if (!updated?.id) return;
    setAppointments((prev) =>
      prev.map((a) => (a.id === updated.id ? { ...a, ...updated } : a))
    );
  }

  async function loadAppointments() {
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/appointments", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(json?.error || `Failed to load appointments (${res.status})`);
        setAppointments([]);
        return;
      }

      const list: Appointment[] = Array.isArray(json)
        ? json
        : Array.isArray(json?.appointments)
        ? json.appointments
        : [];

      setAppointments(list);
    } catch (e: any) {
      setError(e?.message || "Failed to load appointments");
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAppointments();
  }, []);

  const sortedAppointments = useMemo(() => {
    const copy = [...appointments];
    copy.sort((a, b) => {
      const ta = new Date(a.starts_at).getTime();
      const tb = new Date(b.starts_at).getTime();
      return tb - ta;
    });
    return copy;
  }, [appointments]);

  async function addAppointment() {
    if (adding) return; // 🔒 hard guard

    setError(null);
    setInfo(null);

    const trimmed = patientName.trim();
    const startsAtDb = datetimeLocalToDb(startsAtLocal);

    if (!trimmed) {
      setError("Please enter a patient name.");
      return;
    }
    if (!startsAtDb) {
      setError("Please pick a date/time.");
      return;
    }

    // 🔥 LIMPIAMOS INPUTS INMEDIATAMENTE
    setPatientName("");
    setStartsAtLocal("");
    setAdding(true);

    try {
      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          patient_name: trimmed,
          starts_at: startsAtDb,
        }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(json?.error || `Failed to create appointment (${res.status})`);
        return;
      }

      setInfo("Appointment created.");

      // Mantener reload completo aquí (normalización server)
      await loadAppointments();
    } catch (e: any) {
      setError(e?.message || "Failed to create appointment");
    } finally {
      // ⏱️ COOLDOWN ANTI-SPAM (800 ms)
      if (addCooldownRef.current) {
        window.clearTimeout(addCooldownRef.current);
      }
      addCooldownRef.current = window.setTimeout(() => {
        setAdding(false);
      }, 800);
    }
  }

  async function updateStatus(id: string, status: AllowedStatus) {
    setError(null);
    setInfo(null);
    setPending(id, true);

    try {
      const isCheckIn = status === "checked_in";

      const res = await fetch(`/api/appointments/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          isCheckIn ? { action: "check_in" } : { status }
        ),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || `Failed to update (${res.status})`);
        return;
      }

      patchAppointmentInState(json?.appointment ?? null);
      setInfo("Updated.");
    } catch (e: any) {
      setError(e?.message || "Failed to update");
    } finally {
      setPending(id, false);
    }
  }

  async function excuseNoShow(id: string) {
    setError(null);
    setInfo(null);
    setPending(id, true);

    try {
      const reason = prompt("Reason (optional):") || null;

      const res = await fetch(`/api/appointments/${id}/excuse`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || `Failed to excuse (${res.status})`);
        return;
      }

      patchAppointmentInState(json?.appointment ?? null);
      setInfo("No-show excused.");
    } catch (e: any) {
      setError(e?.message || "Failed to excuse");
    } finally {
      setPending(id, false);
    }
  }

  function openDatePicker() {
    const el = dateInputRef.current;
    if (!el) return;
    const anyEl: any = el as any;
    if (typeof anyEl.showPicker === "function") anyEl.showPicker();
    else el.focus();
  }

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>Appointments</h1>

      {(error || info) && (
        <div
          style={{
            border: "1px solid #333",
            padding: 12,
            marginBottom: 16,
            background: error ? "rgba(255,0,0,0.08)" : "rgba(0,255,0,0.08)",
          }}
        >
          {error ? `Error: ${error}` : info}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <input
          placeholder="Patient name"
          value={patientName}
          onChange={(e) => setPatientName(e.target.value)}
          disabled={adding}
          style={{ padding: 10, minWidth: 240 }}
        />

        <button
          type="button"
          onClick={openDatePicker}
          disabled={adding}
          style={{ padding: "10px 12px", border: "1px solid #333" }}
          title="Pick date"
        >
          📅 Pick date
        </button>

        <input
          ref={dateInputRef}
          type="datetime-local"
          value={startsAtLocal}
          onChange={(e) => setStartsAtLocal(e.target.value)}
          disabled={adding}
          style={{ padding: 10 }}
        />

        <button onClick={addAppointment} disabled={adding} style={{ padding: "10px 14px" }}>
          {adding ? "Adding…" : "Add"}
        </button>

        <button onClick={loadAppointments} style={{ padding: "10px 14px" }}>
          Refresh
        </button>

        {loading && <span style={{ opacity: 0.7 }}>Loading…</span>}
      </div>

      {/* resto del componente: tabla SIN CAMBIOS */}
