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

function toLocalDisplay(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function StatusLabel(a: Appointment) {
  if (a.status === "no_show" && a.no_show_excused) return "no_show (excused)";
  return String(a.status);
}

function FeeLabel(a: Appointment) {
  if (a.no_show_fee_charged) return "charged";
  if (a.no_show_fee_pending) return "pending";
  return "-";
}

function AppointmentRow({
  a,
  onCheckIn,
  onUpdateStatus,
  onExcuse,
}: {
  a: Appointment;
  onCheckIn: (id: string) => void;
  onUpdateStatus: (id: string, status: AllowedStatus) => void;
  onExcuse: (id: string) => void;
}) {
  const startsMs = new Date(a.starts_at).getTime();
  const isFuture = !Number.isNaN(startsMs) && startsMs > Date.now();

  return (
    <tr style={{ borderBottom: "1px solid #222" }}>
      <td style={{ padding: 10 }}>{a.patient_name}</td>
      <td style={{ padding: 10, whiteSpace: "nowrap" }}>{toLocalDisplay(a.starts_at)}</td>
      <td style={{ padding: 10 }}>{StatusLabel(a)}</td>
      <td style={{ padding: 10, whiteSpace: "nowrap" }}>
        {a.checked_in_at ? toLocalDisplay(a.checked_in_at) : "-"}
      </td>
      <td style={{ padding: 10, whiteSpace: "nowrap" }}>{FeeLabel(a)}</td>
      <td style={{ padding: 10, whiteSpace: "nowrap" }}>
        <button onClick={() => onCheckIn(a.id)} style={{ marginRight: 8 }}>
          Check-in
        </button>
        <button onClick={() => onUpdateStatus(a.id, "late")} style={{ marginRight: 8 }}>
          Mark late
        </button>

        <button
          onClick={() => onUpdateStatus(a.id, "no_show")}
          disabled={isFuture}
          title={
            isFuture ? "No-show solo se puede marcar después de la hora de inicio" : undefined
          }
          style={{
            marginRight: 8,
            opacity: isFuture ? 0.5 : 1,
            cursor: isFuture ? "not-allowed" : "pointer",
          }}
        >
          Mark no-show
        </button>

        <button onClick={() => onUpdateStatus(a.id, "canceled")} style={{ marginRight: 8 }}>
          Cancel
        </button>
        <button onClick={() => onExcuse(a.id)}>Excuse</button>
      </td>
    </tr>
  );
}

export default function DashboardClient() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(false);

  const [creating, setCreating] = useState(false);
  const creatingLockRef = useRef(false);

  const [patientName, setPatientName] = useState("");
  const [startsAt, setStartsAt] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function loadAppointments() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/appointments", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Failed to load appointments");
      setAppointments(json?.appointments || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load appointments");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAppointments();
    const t = setInterval(() => loadAppointments(), 15000);
    return () => clearInterval(t);
  }, []);

  const nowMs = Date.now();

  const upcoming = useMemo(() => {
    return appointments
      .filter((a) => {
        const ms = new Date(a.starts_at).getTime();
        return !Number.isNaN(ms) && ms >= nowMs;
      })
      .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  }, [appointments, nowMs]);

  const past = useMemo(() => {
    return appointments
      .filter((a) => {
        const ms = new Date(a.starts_at).getTime();
        return !Number.isNaN(ms) && ms < nowMs;
      })
      .sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime());
  }, [appointments, nowMs]);

  async function createAppointment() {
    if (creatingLockRef.current) return;
    creatingLockRef.current = true;

    setError(null);
    setInfo(null);

    try {
      setCreating(true);

      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          patient_name: patientName,
          starts_at: startsAt,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || `Failed to create (${res.status})`);
        return;
      }

      setPatientName("");
      setStartsAt("");
      setInfo("Appointment created.");
      await loadAppointments();
    } catch (e: any) {
      setError(e?.message || "Failed to create appointment");
    } finally {
      setCreating(false);
      creatingLockRef.current = false;
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

      setInfo(`Updated to ${status}.`);
      await loadAppointments();
    } catch (e: any) {
      setError(e?.message || "Failed to update status");
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

      setInfo("Excused.");
      await loadAppointments();
    } catch (e: any) {
      setError(e?.message || "Failed to excuse");
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 22, marginBottom: 12 }}>Dashboard</h1>

      <div style={{ marginBottom: 12 }}>
        <button onClick={loadAppointments} disabled={loading}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {error ? (
        <div style={{ marginBottom: 12, color: "#ff6b6b" }}>{error}</div>
      ) : null}
      {info ? (
        <div style={{ marginBottom: 12, color: "#51cf66" }}>{info}</div>
      ) : null}

      <div style={{ border: "1px solid #222", padding: 16, marginBottom: 18 }}>
        <h2 style={{ fontSize: 16, marginBottom: 10 }}>Add appointment</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
          <button onClick={createAppointment} disabled={creating}>
            {creating ? "Adding..." : "Add"}
          </button>
        </div>
      </div>

      <h2 style={{ fontSize: 16, marginBottom: 10 }}>Upcoming</h2>
      <div style={{ overflowX: "auto", marginBottom: 18 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #222" }}>
              <th style={{ padding: 10 }}>Patient</th>
              <th style={{ padding: 10 }}>Starts at</th>
              <th style={{ padding: 10 }}>Status</th>
              <th style={{ padding: 10 }}>Check-in time</th>
              <th style={{ padding: 10 }}>Fee</th>
              <th style={{ padding: 10 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {upcoming.map((a) => (
              <AppointmentRow
                key={a.id}
                a={a}
                onCheckIn={checkIn}
                onUpdateStatus={updateStatus}
                onExcuse={excuseNoShow}
              />
            ))}
            {upcoming.length === 0 ? (
              <tr>
                <td style={{ padding: 10 }} colSpan={6}>
                  No upcoming appointments.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <h2 style={{ fontSize: 16, marginBottom: 10 }}>Past</h2>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #222" }}>
              <th style={{ padding: 10 }}>Patient</th>
              <th style={{ padding: 10 }}>Starts at</th>
              <th style={{ padding: 10 }}>Status</th>
              <th style={{ padding: 10 }}>Check-in time</th>
              <th style={{ padding: 10 }}>Fee</th>
              <th style={{ padding: 10 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {past.map((a) => (
              <AppointmentRow
                key={a.id}
                a={a}
                onCheckIn={checkIn}
                onUpdateStatus={updateStatus}
                onExcuse={excuseNoShow}
              />
            ))}
            {past.length === 0 ? (
              <tr>
                <td style={{ padding: 10 }} colSpan={6}>
                  No past appointments.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
