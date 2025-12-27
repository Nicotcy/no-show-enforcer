"use client";

import { useEffect, useMemo, useState } from "react";

type AllowedStatus = "scheduled" | "checked_in" | "late" | "no_show" | "canceled";

type Appointment = {
  id: string;
  patient_name: string;
  starts_at: string; // stored as string from API
  status: AllowedStatus | string;
  checked_in_at: string | null;
  no_show_excused: boolean | null;
  no_show_fee_charged: boolean | null;
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

// Convert datetime-local ("2025-12-27T20:30") to a plain timestamp string
// suitable for Postgres timestamp without timezone.
// Output: "YYYY-MM-DDTHH:mm:00"
function datetimeLocalToDb(value: string) {
  // value already comes like "YYYY-MM-DDTHH:mm"
  if (!value) return "";
  // Add seconds
  return `${value}:00`;
}

export default function DashboardClient() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(false);

  const [patientName, setPatientName] = useState("");
  const [startsAtLocal, setStartsAtLocal] = useState(""); // datetime-local

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

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

      // Be flexible with the response shape:
      // - { appointments: [...] }
      // - [...] (array)
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
      return tb - ta; // newest first
    });
    return copy;
  }, [appointments]);

  async function addAppointment() {
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

      // Support { appointment: {...} } or returning the row directly
      const created: Appointment | null =
        json?.appointment ?? (json?.id ? json : null);

      if (created) {
        // Optimistic insert so you see it immediately
        setAppointments((prev) => [created, ...prev]);
      }

      setPatientName("");
      setStartsAtLocal("");
      setInfo("Appointment created.");

      // Also re-fetch to be 100% consistent with DB
      await loadAppointments();
    } catch (e: any) {
      setError(e?.message || "Failed to create appointment");
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
          style={{ padding: 10, minWidth: 240 }}
        />

        <input
          type="datetime-local"
          value={startsAtLocal}
          onChange={(e) => setStartsAtLocal(e.target.value)}
          style={{ padding: 10 }}
        />

        <button onClick={addAppointment} style={{ padding: "10px 14px" }}>
          Add
        </button>

        <button onClick={loadAppointments} style={{ padding: "10px 14px" }}>
          Refresh
        </button>

        {loading && <span style={{ opacity: 0.7 }}>Loading…</span>}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #333" }}>
              <th style={{ padding: 10 }}>Patient</th>
              <th style={{ padding: 10 }}>Starts at</th>
              <th style={{ padding: 10 }}>Status</th>
              <th style={{ padding: 10 }}>Checked-in</th>
              <th style={{ padding: 10 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedAppointments.map((a) => {
              const checkedIn = a.checked_in_at ? "Yes" : "No";
              return (
                <tr key={a.id} style={{ borderBottom: "1px solid #222" }}>
                  <td style={{ padding: 10 }}>{a.patient_name}</td>
                  <td style={{ padding: 10 }}>{toLocalDisplay(a.starts_at)}</td>
                  <td style={{ padding: 10 }}>{a.status}</td>
                  <td style={{ padding: 10 }}>{checkedIn}</td>
                  <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                    <button onClick={() => updateStatus(a.id, "checked_in")} style={{ marginRight: 8 }}>
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
                    <button onClick={() => excuseNoShow(a.id)}>
                      Excuse
                    </button>
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
