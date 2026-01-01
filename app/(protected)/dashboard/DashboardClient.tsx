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

function isPast(startsAtIso: string) {
  const t = new Date(startsAtIso).getTime();
  if (Number.isNaN(t)) return false;
  return t < Date.now();
}

function FeeLabel(a: Appointment) {
  if (a.no_show_fee_charged) return "Charged";
  if (a.no_show_fee_pending) return "Pending";
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
}: {
  a: Appointment;
  onCheckIn: (id: string) => void;
  onUpdateStatus: (id: string, status: AllowedStatus) => void;
  onExcuse: (id: string) => void;
}) {
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
        <button onClick={() => onUpdateStatus(a.id, "no_show")} style={{ marginRight: 8 }}>
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
    if (creatingLockRef.current) return;
    creatingLockRef.current = true;

    setError(null);
    setInfo(null);

    const name = patientName.trim();
    if (!name) {
      setError("Patient name is required.");
      creatingLockRef.current = false;
      return;
    }
    if (!startsAtLocal) {
      setError("Start time is required.");
      creatingLockRef.current = false;
      return;
    }

    setCreating(true);
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

    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        loadAppointments();
      }
    }, 15000);

    return () => window.clearInterval(id);
  }, []);

  const { upcoming, past } = useMemo(() => {
    const up: Appointment[] = [];
    const pa: Appointment[] = [];

    for (const a of appointments) {
      if (isPast(a.starts_at)) pa.push(a);
      else up.push(a);
    }

    // Upcoming: lo más cercano primero
    up.sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
    // Past: lo más reciente primero
    pa.sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime());

    return { upcoming: up, past: pa };
  }, [appointments]);

  const tableHeader = (
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
  );

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ fontSize: 28, marginBottom: 20 }}>Dashboard</h2>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <input
          placeholder="Patient name"
          value={patientName}
          onChange={(e) => setPatientName(e.target.value)}
          style={{ padding: 10, minWidth: 240 }}
          disabled={creating}
        />

        <input
          ref={dateInputRef}
          type="datetime-local"
          value={startsAtLocal}
          onChange={(e) => setStartsAtLocal(e.target.value)}
          style={{ padding: 10, border: "1px solid #333" }}
          disabled={creating}
        />

        <button
          type="button"
          onClick={openDatePicker}
          style={{ padding: "10px 12px", border: "1px solid #333" }}
          title="Pick date"
          disabled={creating}
        >
          📅 Pick date
        </button>

        <button onClick={addAppointment} style={{ padding: "10px 14px" }} disabled={creating}>
          {creating ? "Adding..." : "Add"}
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

      <div style={{ marginBottom: 10, opacity: 0.9 }}>
        Upcoming ({upcoming.length}) · Past ({past.length})
      </div>

      <div style={{ marginBottom: 18, overflowX: "auto" }}>
        <div style={{ fontSize: 18, margin: "10px 0" }}>Upcoming</div>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
          {tableHeader}
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
            {upcoming.length === 0 && !loading && (
              <tr>
                <td style={{ padding: 10, opacity: 0.7 }} colSpan={6}>
                  No upcoming appointments.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ overflowX: "auto" }}>
        <div style={{ fontSize: 18, margin: "10px 0" }}>Past</div>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
          {tableHeader}
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
            {past.length === 0 && !loading && (
              <tr>
                <td style={{ padding: 10, opacity: 0.7 }} colSpan={6}>
                  No past appointments.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
