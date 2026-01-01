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
};

function isoToDatetimeLocal(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function datetimeLocalToDb(value: string) {
  // El input datetime-local no tiene timezone; lo interpretamos como local del navegador
  // y lo convertimos a ISO para DB.
  const d = new Date(value);
  return d.toISOString();
}

export default function DashboardClient() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [patientName, setPatientName] = useState("");
  const [startsAtLocal, setStartsAtLocal] = useState("");

  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const dateInputRef = useRef<HTMLInputElement | null>(null);

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

  async function addAppointment() {
    setError(null);
    setInfo(null);

    const name = patientName.trim();
    const starts = startsAtLocal.trim();

    if (!name) {
      setError("Patient name is required.");
      return;
    }
    if (!starts) {
      setError("Start time is required.");
      return;
    }

    setCreating(true);
    try {
      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          patient_name: name,
          starts_at: datetimeLocalToDb(starts),
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || `Failed to create (${res.status})`);
        return;
      }

      const created: Appointment | null =
        json?.appointment ?? (json?.id ? json : null);

      if (created) {
        setAppointments((prev) => [created, ...prev]);
      }

      setPatientName("");
      setStartsAtLocal("");
      setInfo("Appointment created.");

      await loadAppointments();
    } catch (e: any) {
      setError(e?.message || "Failed to create appointment");
    } finally {
      setCreating(false);
    }
  }

  async function updateStatus(id: string, status: AllowedStatus) {
    setError(null);
    setInfo(null);

    // optimista tras éxito: el dashboard refleja el cambio sin refresh manual
    const nowIso = new Date().toISOString();

    try {
      const res = await fetch(`/api/appointments/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || `Failed to update (${res.status})`);
        return;
      }

      // actualización inmediata en memoria
      setAppointments((prev) =>
        prev.map((a) => {
          if (a.id !== id) return a;
          return {
            ...a,
            status,
            checked_in_at: status === "checked_in" ? nowIso : a.checked_in_at,
          };
        })
      );

      setInfo("Updated.");

      // red de seguridad: re-sincroniza por si cambian más campos server-side
      await loadAppointments();
    } catch (e: any) {
      setError(e?.message || "Failed to update");
    }
  }

  async function excuseNoShow(id: string) {
    setError(null);
    setInfo(null);

    const reason = window.prompt("Reason (optional):")?.trim() ?? "";

    try {
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

      // update inmediato (sin esperar refresh)
      setAppointments((prev) =>
        prev.map((a) => {
          if (a.id !== id) return a;
          return { ...a, no_show_excused: true };
        })
      );

      setInfo("No-show excused.");
      await loadAppointments();
    } catch (e: any) {
      setError(e?.message || "Failed to excuse no-show");
    }
  }

  const sortedAppointments = useMemo(() => {
    const copy = [...appointments];
    copy.sort((a, b) => {
      const ta = new Date(a.starts_at).getTime();
      const tb = new Date(b.starts_at).getTime();
      return tb - ta;
    });
    return copy;
  }, [appointments]);

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 20, marginBottom: 16 }}>Dashboard</h1>

      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            placeholder="Patient name"
            value={patientName}
            onChange={(e) => setPatientName(e.target.value)}
            style={{ padding: 8, minWidth: 220 }}
          />

          <input
            ref={dateInputRef}
            type="datetime-local"
            value={startsAtLocal}
            onChange={(e) => setStartsAtLocal(e.target.value)}
            style={{ padding: 8 }}
          />

          <button
            type="button"
            onClick={() => dateInputRef.current?.showPicker?.()}
            style={{ padding: "8px 10px" }}
          >
            Pick date
          </button>

          <button
            onClick={addAppointment}
            disabled={creating}
            style={{ padding: "8px 12px" }}
          >
            {creating ? "Creating..." : "Create"}
          </button>

          <button
            onClick={loadAppointments}
            disabled={loading}
            style={{ padding: "8px 12px" }}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ marginBottom: 12, color: "crimson" }}>{error}</div>
      )}
      {info && <div style={{ marginBottom: 12, color: "green" }}>{info}</div>}

      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            border: "1px solid #ddd",
          }}
        >
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #ddd" }}>
                Patient
              </th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #ddd" }}>
                Starts at
              </th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #ddd" }}>
                Status
              </th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #ddd" }}>
                Flags
              </th>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #ddd" }}>
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedAppointments.map((a) => {
              const startsLocal = isoToDatetimeLocal(a.starts_at);
              const statusLabel =
                a.status === "no_show" && a.no_show_excused
                  ? "no_show (excused)"
                  : String(a.status);

              const flags: string[] = [];
              if (a.no_show_fee_charged) flags.push("fee charged");
              if (a.checked_in_at) flags.push("checked_in_at");

              return (
                <tr key={a.id}>
                  <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>
                    {a.patient_name}
                  </td>
                  <td style={{ padding: 10, borderBottom: "1px solid #eee", whiteSpace: "nowrap" }}>
                    {startsLocal}
                  </td>
                  <td style={{ padding: 10, borderBottom: "1px solid #eee" }}>
                    {statusLabel}
                  </td>
                  <td style={{ padding: 10, borderBottom: "1px solid #eee", opacity: 0.85 }}>
                    {flags.length ? flags.join(", ") : "-"}
                  </td>
                  <td style={{ padding: 10, whiteSpace: "nowrap", borderBottom: "1px solid #eee" }}>
                    <button
                      onClick={() => updateStatus(a.id, "checked_in")}
                      style={{ marginRight: 8 }}
                    >
                      Check-in
                    </button>
                    <button
                      onClick={() => updateStatus(a.id, "late")}
                      style={{ marginRight: 8 }}
                    >
                      Mark late
                    </button>
                    <button
                      onClick={() => updateStatus(a.id, "no_show")}
                      style={{ marginRight: 8 }}
                    >
                      Mark no-show
                    </button>
                    <button
                      onClick={() => updateStatus(a.id, "canceled")}
                      style={{ marginRight: 8 }}
                    >
                      Cancel
                    </button>
                    <button onClick={() => excuseNoShow(a.id)}>Excuse</button>
                  </td>
                </tr>
              );
            })}

            {sortedAppointments.length === 0 && !loading && (
              <tr>
                <td style={{ padding: 10, opacity: 0.7 }} colSpan={5}>
                  No appointments yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
