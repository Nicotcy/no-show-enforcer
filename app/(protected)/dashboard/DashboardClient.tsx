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
  no_show_fee_pending: boolean | null;
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

export default function DashboardClient() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(false);

  const [patientName, setPatientName] = useState("");
  const [startsAtLocal, setStartsAtLocal] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const dateInputRef = useRef<HTMLInputElement | null>(null);

  function openDatePicker() {
    const el = dateInputRef.current;
    if (!el) return;

    const anyEl = el as any;
    if (typeof anyEl.showPicker === "function") anyEl.showPicker();
    else el.focus();
  }

  async function loadAppointments() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/appointments", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setAppointments([]);
        setError(json?.error || `Failed to load appointments (${res.status})`);
        return;
      }

      const list: Appointment[] = Array.isArray(json)
        ? json
        : Array.isArray(json?.appointments)
          ? json.appointments
          : [];

      setAppointments(list);
    } catch (e: any) {
      setAppointments([]);
      setError(e?.message || "Failed to load appointments");
    } finally {
      setLoading(false);
    }
  }

  async function addAppointment() {
    setError(null);
    setInfo(null);

    const name = patientName.trim();
    if (!name) {
      setError("Patient name is required.");
      return;
    }
    if (!startsAtLocal) {
      setError("Start time is required.");
      return;
    }

    try {
      const startsAtIso = new Date(startsAtLocal).toISOString();

      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ patient_name: name, starts_at: startsAtIso }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || `Failed to add (${res.status})`);
        return;
      }

      setPatientName("");
      setStartsAtLocal("");
      setInfo("Appointment created.");

      await loadAppointments();
    } catch (e: any) {
      setError(e?.message || "Failed to add");
    }
  }

  async function updateStatus(id: string, status: AllowedStatus) {
    setError(null);
    setInfo(null);
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

      setInfo("Updated.");
      await loadAppointments();
    } catch (e: any) {
      setError(e?.message || "Failed to update");
    }
  }

  async function checkIn(id: string) {
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(`/api/appointments/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "check_in" }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || `Failed to check-in (${res.status})`);
        return;
      }

      setInfo("Checked in.");
      await loadAppointments();
    } catch (e: any) {
      setError(e?.message || "Failed to check-in");
    }
  }

  async function excuseNoShow(id: string) {
    setError(null);
    setInfo(null);
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

      setInfo("No-show excused.");
      await loadAppointments();
    } catch (e: any) {
      setError(e?.message || "Failed to excuse");
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

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ fontSize: 28, marginBottom: 20 }}>Dashboard</h2>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <input
          placeholder="Patient name"
          value={patientName}
          onChange={(e) => setPatientName(e.target.value)}
          style={{ padding: 10, minWidth: 240 }}
        />

        <input
          ref={dateInputRef}
          type="datetime-local"
          value={startsAtLocal}
          onChange={(e) => setStartsAtLocal(e.target.value)}
          style={{ padding: 10, border: "1px solid #333" }}
        />

        <button
          type="button"
          onClick={openDatePicker}
          style={{ padding: "10px 12px", border: "1px solid #333" }}
          title="Pick date"
        >
          📅 Pick date
        </button>

        <button onClick={addAppointment} style={{ padding: "10px 14px" }}>
          Add
        </button>

        <button
          onClick={loadAppointments}
          disabled={loading}
          style={{ padding: "10px 14px" }}
          title="Reload appointments list"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {error && <div style={{ color: "#ff6b6b", marginBottom: 12 }}>{error}</div>}
      {info && <div style={{ color: "#7ee787", marginBottom: 12 }}>{info}</div>}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #333" }}>
              <th style={{ padding: 10 }}>Patient</th>
              <th style={{ padding: 10 }}>Starts at</th>
              <th style={{ padding: 10 }}>Status</th>
              <th style={{ padding: 10 }}>Check-in time</th>
              <th style={{ padding: 10 }}>Fee</th>
              <th style={{ padding: 10 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedAppointments.map((a) => {
              const statusLabel =
                a.status === "no_show" && a.no_show_excused ? "no_show (excused)" : String(a.status);

              const checkInLabel = a.checked_in_at ? toLocalDisplay(a.checked_in_at) : "-";

              let feeLabel = "-";
              if (a.no_show_fee_charged) feeLabel = "Charged";
              else if (a.no_show_fee_pending) feeLabel = "Pending";

              return (
                <tr key={a.id} style={{ borderBottom: "1px solid #222" }}>
                  <td style={{ padding: 10 }}>{a.patient_name}</td>
                  <td style={{ padding: 10 }}>{toLocalDisplay(a.starts_at)}</td>
                  <td style={{ padding: 10 }}>{statusLabel}</td>
                  <td style={{ padding: 10, whiteSpace: "nowrap" }}>{checkInLabel}</td>
                  <td style={{ padding: 10, whiteSpace: "nowrap" }}>{feeLabel}</td>
                  <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                    <button onClick={() => checkIn(a.id)} style={{ marginRight: 8 }}>
                      Check-in
                    </button>
                    <button onClick={() => updateStatus(a.id, "late")} style={{ marginRight: 8 }}>
                      Mark late
                    </button>
                    <button onClick={() => updateStatus(a.id, "no_show")} style={{ marginRight: 8 }}>
                      Mark no-show
                    </button>
                    <button onClick={() => updateStatus(a.id, "canceled")} style={{ marginRight: 8 }}>
                      Cancel
                    </button>
                    <button onClick={() => excuseNoShow(a.id)}>Excuse</button>
                  </td>
                </tr>
              );
            })}

            {sortedAppointments.length === 0 && !loading && (
              <tr>
                <td style={{ padding: 10, opacity: 0.7 }} colSpan={6}>
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
