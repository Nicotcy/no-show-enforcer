"use client";

import { useEffect, useState } from "react";

export default function DashboardClient() {
  const [appointments, setAppointments] = useState<any[]>([]);
  const [patientName, setPatientName] = useState("");
  const [startsAt, setStartsAt] = useState("");

  async function load() {
    const res = await fetch("/api/appointments");
    const data = await res.json();
    setAppointments(data);
  }

  useEffect(() => {
    load();
  }, []);

  async function createAppointment() {
    await fetch("/api/appointments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patient_name: patientName,
        starts_at: startsAt,
      }),
    });

    setPatientName("");
    setStartsAt("");
    load();
  }

  async function update(id: string, payload: any) {
    await fetch(`/api/appointments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    load();
  }

  return (
    <div style={{ display: "grid", gap: 24 }}>
      {/* Create appointment */}
      <div style={{ display: "flex", gap: 8 }}>
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
      </div>

      {/* Table */}
      <table>
        <thead>
          <tr>
            <th>Patient</th>
            <th>Starts at</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {appointments.map((a) => (
            <tr key={a.id}>
              <td>{a.patient_name}</td>
              <td>{new Date(a.starts_at).toLocaleString()}</td>
              <td>{a.status}</td>
              <td style={{ display: "flex", gap: 4 }}>
                <button onClick={() => update(a.id, { status: "no_show" })}>
                  No-show
                </button>
                <button onClick={() => update(a.id, { status: "late" })}>
                  Late
                </button>
                <button onClick={() => update(a.id, { status: "canceled" })}>
                  Cancel
                </button>
                <button
                  onClick={() =>
                    update(a.id, {
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
    </div>
  );
}
