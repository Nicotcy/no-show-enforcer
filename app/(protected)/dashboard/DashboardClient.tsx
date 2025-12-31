"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type AllowedStatus =
  | "scheduled"
  | "checked_in"
  | "late"
  | "no_show"
  | "canceled"
  | "late_cancel";

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
  // value is "YYYY-MM-DDTHH:mm" from datetime-local, interpreted as LOCAL time.
  // Convert to UTC ISO string with Z so DB timestamptz is consistent.
  const d = new Date(`${value}:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

export default function DashboardClient() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(false);

  const [patientName, setPatientName] = useState("");
  const [startsAtLocal, setStartsAtLocal] = useState("");

  const [adding, setAdding] = useState(false);
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
    if (adding) return;

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
      await loadAppointments();
    } catch (e: any) {
      setError(e?.message || "Failed to create appointment");
    } finally {
      if (addCooldownRef.current) window.clearTimeout(addCooldownRef.current);
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
        body: JSON.stringify(isCheckIn ? { action: "check_in" } : { status }),
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

  function formatStatus(a: Appointment) {
    if (a.status === "no_show" && a.no_show_excused) return "no_show (excused)";
    if (a.status === "late_cancel") return "late_cancel";
    return String(a.status);
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
              const isPending = Boolean(pendingById[a.id]);

              const status = String(a.status).toLowerCase();
              const isScheduled = status === "scheduled";
              const isLate = status === "late";
              const isNoShow = status === "no_show";
              const isCheckedIn = status === "checked_in";
              const isTerminal = status === "canceled" || status === "late_cancel";

              const canCheckIn = (isScheduled || isLate) && !isPending && !isTerminal;
              const canMarkLate = isScheduled && !isPending && !isTerminal;
              const canMarkNoShow = (isScheduled || isLate) && !isPending && !isTerminal;
              const canCancel = (isScheduled || isLate) && !isPending && !isTerminal && !isCheckedIn && !isNoShow;

              const alreadyExcused = Boolean(a.no_show_excused);
              const canExcuse = isNoShow && !alreadyExcused && !isPending && !isTerminal;

              return (
                <tr key={a.id} style={{ borderBottom: "1px solid #222" }}>
                  <td style={{ padding: 10 }}>{a.patient_name}</td>
                  <td style={{ padding: 10 }}>{toLocalDisplay(a.starts_at)}</td>
                  <td style={{ padding: 10 }}>
                    {formatStatus(a)}
                    {isPending && <span style={{ marginLeft: 8, opacity: 0.7 }}>Saving…</span>}
                  </td>
                  <td style={{ padding: 10 }}>{checkedIn}</td>
                  <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                    <button
                      disabled={!canCheckIn}
                      onClick={() => updateStatus(a.id, "checked_in")}
                      style={{ marginRight: 8 }}
                      title={!canCheckIn ? "Only scheduled/late can be checked-in" : "Check-in"}
                    >
                      Check-in
                    </button>

                    <button
                      disabled={!canMarkLate}
                      onClick={() => updateStatus(a.id, "late")}
                      style={{ marginRight: 8 }}
                      title={!canMarkLate ? "Only scheduled can be marked late" : "Mark late"}
                    >
                      Mark late
                    </button>

                    <button
                      disabled={!canMarkNoShow}
                      onClick={() => updateStatus(a.id, "no_show")}
                      style={{ marginRight: 8 }}
                      title={!canMarkNoShow ? "Only scheduled/late can be marked no-show" : "Mark no-show"}
                    >
                      Mark no-show
                    </button>

                    <button
                      disabled={!canCancel}
                      onClick={() => updateStatus(a.id, "canceled")}
                      style={{ marginRight: 8 }}
                      title={!canCancel ? "Only scheduled/late can be canceled" : "Cancel"}
                    >
                      Cancel
                    </button>

                    <button
                      disabled={!canExcuse}
                      onClick={() => excuseNoShow(a.id)}
                      title={
                        alreadyExcused
                          ? "Already excused"
                          : !canExcuse
                          ? "Only no-show can be excused"
                          : "Excuse"
                      }
                    >
                      {alreadyExcused ? "Excused" : "Excuse"}
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
