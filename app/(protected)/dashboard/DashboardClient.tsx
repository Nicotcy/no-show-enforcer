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
  no_show_fee_processing_at: string | null;
  no_show_fee_attempt_count: number | null;
  no_show_fee_last_error: string | null;
};

function toLocalDisplay(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function FeeLabel(a: Appointment) {
  if (a.no_show_fee_charged) return "charged";

  // Si está lockeada para cobro, mostramos processing aunque siga pending
  if (a.no_show_fee_processing_at) return "processing";

  if (a.no_show_fee_pending) {
    const attempts =
      typeof a.no_show_fee_attempt_count === "number" ? a.no_show_fee_attempt_count : 0;

    if (a.no_show_fee_last_error) {
      if (a.no_show_fee_last_error === "MAX_ATTEMPTS_REACHED") {
        return attempts > 0 ? `failed (max, attempts: ${attempts})` : "failed (max)";
      }
      return attempts > 0 ? `pending (attempts: ${attempts})` : "pending";
    }

    return attempts > 0 ? `pending (attempts: ${attempts})` : "pending";
  }

  return "-";
}

function StatusLabel(a: Appointment) {
  if (a.status === "no_show" && a.no_show_excused) return "no_show (excused)";
  return String(a.status);
}

function AppointmentRow({
  a,
  onCheckIn,
  onUpdateStatus,
  onExcuse,
  onUndo,
}: {
  a: Appointment;
  onCheckIn: (id: string) => void;
  onUpdateStatus: (id: string, status: AllowedStatus) => void;
  onExcuse: (id: string) => void;
  onUndo: (id: string) => void;
}) {
  const now = Date.now();
  const starts = new Date(a.starts_at).getTime();
  const future = starts > now;

  const disabledTitle =
    "Solo se puede marcar cuando la cita ya ha empezado (después de la hora de inicio).";

  // ✅ Undo visible si late o no_show, siempre que NO esté charged
  const canUndo =
    (a.status === "late" || a.status === "no_show") && !a.no_show_fee_charged;

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
        <button onClick={() => onCheckIn(a.id)} style={{ marginRight: 10 }}>
          Check-in
        </button>

        <button
          onClick={() => onUpdateStatus(a.id, "late")}
          style={{
            marginRight: 10,
            opacity: future ? 0.5 : 1,
            cursor: future ? "not-allowed" : "pointer",
          }}
          disabled={future}
          title={future ? disabledTitle : undefined}
        >
          Mark late
        </button>

        <button
          onClick={() => onUpdateStatus(a.id, "no_show")}
          style={{
            marginRight: 10,
            opacity: future ? 0.5 : 1,
            cursor: future ? "not-allowed" : "pointer",
          }}
          disabled={future}
          title={future ? disabledTitle : undefined}
        >
          Mark no-show
        </button>

        <button
  onClick={() => onUpdateStatus(a.id, "canceled")}
  disabled={!future}
  title={!future ? "A past appointment can’t be cancelled." : undefined}
  style={{
    marginRight: 10,
    opacity: future ? 1 : 0.5,
    cursor: future ? "pointer" : "not-allowed",
  }}
>
  Cancel
</button>


<button
  onClick={() => onExcuse(a.id)}
  disabled={a.status !== "no_show"}
  title={
    a.status !== "no_show"
      ? "Only no-show appointments can be excused."
      : undefined
  }
  style={{
    marginRight: 10,
    opacity: a.status === "no_show" ? 1 : 0.5,
    cursor: a.status === "no_show" ? "pointer" : "not-allowed",
  }}
>
  Excuse
</button>


        {canUndo && (
          <button onClick={() => onUndo(a.id)} style={{ marginRight: 10 }}>
            Undo
          </button>
        )}
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
  const [startsAtLocal, setStartsAtLocal] = useState("");

  const [error, setError] = useState<string | null>(null);

  async function fetchAppointments() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/appointments", { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || `Failed to load (${res.status})`);
        setAppointments([]);
        return;
      }
      setAppointments(Array.isArray(json) ? json : json?.appointments || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load");
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAppointments();
    const t = setInterval(fetchAppointments, 15000);
    return () => clearInterval(t);
  }, []);

  const nowTs = Date.now();

  const upcoming = useMemo(() => {
    return appointments
      .filter((a) => new Date(a.starts_at).getTime() > nowTs)
      .sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  }, [appointments, nowTs]);

  const past = useMemo(() => {
    return appointments
      .filter((a) => new Date(a.starts_at).getTime() <= nowTs)
      .sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime());
  }, [appointments, nowTs]);

  async function createAppointment() {
    const name = patientName.trim();
    if (!name) return;

    if (creatingLockRef.current) return;
    creatingLockRef.current = true;

    setCreating(true);
    setError(null);

    try {
      const startsAtIso = startsAtLocal ? new Date(startsAtLocal).toISOString() : null;
      if (!startsAtIso) {
        setError("Pick a date/time");
        return;
      }

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
      await fetchAppointments();
    } catch (e: any) {
      setError(e?.message || "Failed to add");
    } finally {
      setCreating(false);
      creatingLockRef.current = false;
    }
  }

  async function onCheckIn(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/appointments/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "check_in" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || `Failed (${res.status})`);
        return;
      }
      await fetchAppointments();
    } catch (e: any) {
      setError(e?.message || "Failed");
    }
  }

  async function onUpdateStatus(id: string, status: AllowedStatus) {
    setError(null);
    try {
      const res = await fetch(`/api/appointments/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || `Failed (${res.status})`);
        return;
      }
      await fetchAppointments();
    } catch (e: any) {
      setError(e?.message || "Failed");
    }
  }

  async function onExcuse(id: string) {
    setError(null);
    try {
      const reason = prompt("Reason? (optional)") || "";
      const res = await fetch(`/api/appointments/${id}/excuse`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || `Failed (${res.status})`);
        return;
      }
      await fetchAppointments();
    } catch (e: any) {
      setError(e?.message || "Failed");
    }
  }

  async function onUndo(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/appointments/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "undo" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || `Failed (${res.status})`);
        return;
      }
      await fetchAppointments();
    } catch (e: any) {
      setError(e?.message || "Failed");
    }
  }

  return (
    <div style={{ padding: 20 }}>
      <h1 style={{ marginBottom: 10 }}>Dashboard</h1>

      <div style={{ marginBottom: 12 }}>
        <button onClick={fetchAppointments} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && <div style={{ marginBottom: 10, color: "tomato" }}>{error}</div>}

      <div style={{ marginBottom: 20, padding: 12, border: "1px solid #222" }}>
        <h2 style={{ marginTop: 0 }}>Add appointment</h2>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <input
            placeholder="Patient name"
            value={patientName}
            onChange={(e) => setPatientName(e.target.value)}
          />

          <input
            type="datetime-local"
            value={startsAtLocal}
            onChange={(e) => setStartsAtLocal(e.target.value)}
          />

          <button onClick={createAppointment} disabled={creating}>
            {creating ? "Adding..." : "Add"}
          </button>
        </div>
      </div>

      <h2>Upcoming</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 20 }}>
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
              onCheckIn={onCheckIn}
              onUpdateStatus={onUpdateStatus}
              onExcuse={onExcuse}
              onUndo={onUndo}
            />
          ))}
          {upcoming.length === 0 && (
            <tr>
              <td style={{ padding: 10 }} colSpan={6}>
                No upcoming appointments.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2>Past</h2>
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
              onCheckIn={onCheckIn}
              onUpdateStatus={onUpdateStatus}
              onExcuse={onExcuse}
              onUndo={onUndo}
            />
          ))}
          {past.length === 0 && (
            <tr>
              <td style={{ padding: 10 }} colSpan={6}>
                No past appointments.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
