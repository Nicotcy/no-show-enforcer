"use client";

import { useEffect, useState } from "react";

export default function DashboardClient() {
  const [appointments, setAppointments] = useState<any[]>([]);
  const [patientName, setPatientName] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function load() {
    setErrorMsg(null);
    const res = await fetch("/api/appointments", { cache: "no-store" });
    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      setAppointments([]);
      setErrorMsg(json?.error ?? "Failed to load appointments");
      return;
    }

    setAppointments(Array.isArray(json?.appointments) ? json.appointments : []);
  }

  useEffect(() => {
    load();
  }, []);

  async function createAppointment() {
    setErrorMsg(null);

    const res = await fetch("/api/appointments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patient_name: patientName,
        starts_at: startsAt,
      }),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      setErrorMsg(json?.error ?? "Failed to create appointment");
      return;
    }

    setPatientName("");
    setStartsAt("");
    await load();
  }

  async function patch(id: string, payload: any) {
    setErrorMsg(null);

    const res = await fetch(`/api/appointments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErrorMsg(json?.error ?? "Failed to update appointment");
      return;
    }

    await load();
  }

  function fmt(dt: any) {
    if (!dt) return "";
    try {
      return new Date(dt).toLocaleString();
    } catch {
      return String(dt);
    }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {errorMsg ? (
        <div style={{ padding: 12, border: "1px solid #444" }}>
          Error: {errorMsg}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          placeholder="Patient name"
          value={patientName}
          onChange={(e) => setPatientName(e.target.value)}
        />
        <input
          type="datetime-local"
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
        />
        <button onClick={createAppointment}>Add</button>
        <button onClick={load}>Refresh</button>
      </div>

      {appointments.length === 0 ? (
        <div>No appointments yet.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Patient</th>
              <th>Starts at</th>
              <th>Status</th>
              <th>Checked-in</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {appointments.map((a) => (
              <tr key={a.id}>
                <td>{a.patient_name}</td>
                <td>{fmt(a.starts_at)}</td>
                <td>{a.status}</td>
                <td>{a.checked_in_at ? "Yes" : "No"}</td>
                <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button onClick={() => patch(a.id, { checked_in: true })}>
                    Check-in
                  </button>
                  <button onClick={() => patch(a.id, { status: "late" })}>
                    Mark late
                  </button>
                  <button onClick={() => patch(a.id, { status: "no_show" })}>
                    Mark no-show
                  </button>
                  <button onClick={() => patch(a.id, { cancel: true })}>
                    Cancel
                  </button>
                  <button
                    onClick={() =>
                      patch(a.id, {
                        no_show_excused: true,
                        no_show_excuse_reason: "Manual excuse",
                      })
                    }
                  >
                    Excuse
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
