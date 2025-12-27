"use client";

import { useEffect, useMemo, useState } from "react";

type Appointment = {
  id: string;
  patient_name: string | null;
  starts_at: string; // ISO
  status: string | null;
  checked_in_at: string | null;
  no_show_excused: boolean | null;
};

type ApiError = { error: string };

const ALLOWED_STATUSES = ["scheduled", "checked_in", "late", "no_show", "canceled"] as const;
type AllowedStatus = (typeof ALLOWED_STATUSES)[number];

function formatLocal(dtIso: string) {
  try {
    const d = new Date(dtIso);
    return d.toLocaleString();
  } catch {
    return dtIso;
  }
}

function normalizeStatus(s: string | null | undefined): AllowedStatus | "unknown" {
  const v = String(s ?? "").trim().toLowerCase();
  return (ALLOWED_STATUSES as readonly string[]).includes(v) ? (v as AllowedStatus) : "unknown";
}

export default function DashboardClient() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Create form
  const [patientName, setPatientName] = useState("");
  const [startsAtLocal, setStartsAtLocal] = useState(""); // datetime-local value

  async function fetchAppointments() {
    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/appointments", { cache: "no-store" });
      const json = await res.json();

      if (!res.ok) {
        setErrorMsg((json as ApiError).error ?? "Failed to load appointments");
        setAppointments([]);
        return;
      }

      setAppointments(Array.isArray(json) ? (json as Appointment[]) : []);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to load appointments");
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchAppointments();
  }, []);

  const sorted = useMemo(() => {
    const copy = [...appointments];
    copy.sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
    return copy;
  }, [appointments]);

  async function addAppointment() {
    setErrorMsg(null);

    const name = patientName.trim();
    if (!name) {
      setErrorMsg("Patient name is required.");
      return;
    }
    if (!startsAtLocal) {
      setErrorMsg("Start time is required.");
      return;
    }

    // datetime-local => ISO
    const startsIso = new Date(startsAtLocal).toISOString();

    try {
      const res = await fetch("/api/appointments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ patient_name: name, starts_at: startsIso }),
      });

      const json = await res.json();
      if (!res.ok) {
        setErrorMsg((json as ApiError).error ?? "Failed to create appointment");
        return;
      }

      setPatientName("");
      setStartsAtLocal("");
      await fetchAppointments();
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to create appointment");
    }
  }

  async function patchAppointment(id: string, payload: any) {
    setErrorMsg(null);

    try {
      const res = await fetch(`/api/appointments/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok) {
        setErrorMsg((json as ApiError).error ?? "Update failed");
        return false;
      }

      await fetchAppointments();
      return true;
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Update failed");
      return false;
    }
  }

  // Actions that match backend expectations EXACTLY
  function actionCheckIn(id: string) {
    return patchAppointment(id, { action: "check_in" });
  }
  function actionExcuse(id: string) {
    const reason = window.prompt("Reason (optional):") ?? "";
    return patchAppointment(id, { action: "excuse", reason: reason.trim() || null });
  }
  function actionSetStatus(id: string, status: AllowedStatus) {
    return patchAppointment(id, { status });
  }

  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      <h2 style={{ fontSize: 22, marginBottom: 12 }}>Appointments</h2>

      {errorMsg && (
        <div
          style={{
            border: "1px solid rgba(255,255,255,0.25)",
            padding: 12,
            marginBottom: 16,
            borderRadius: 8,
            background: "rgba(255,255,255,0.06)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div>Error: {errorMsg}</div>
            <button
              onClick={() => setErrorMsg(null)}
              style={{
                border: "1px solid rgba(255,255,255,0.25)",
                background: "transparent",
                color: "inherit",
                padding: "6px 10px",
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 18, flexWrap: "wrap" }}>
        <input
          placeholder="Patient name"
          value={patientName}
          onChange={(e) => setPatientName(e.target.value)}
          style={{
            padding: 10,
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.2)",
            background: "rgba(0,0,0,0.2)",
            color: "inherit",
            minWidth: 220,
          }}
        />

        <input
          type="datetime-local"
          value={startsAtLocal}
          onChange={(e) => setStartsAtLocal(e.target.value)}
          style={{
            padding: 10,
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.2)",
            background: "rgba(0,0,0,0.2)",
            color: "inherit",
            minWidth: 220,
          }}
        />

        <button
          onClick={addAppointment}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.25)",
            background: "transparent",
            color: "inherit",
            cursor: "pointer",
          }}
        >
          Add
        </button>

        <button
          onClick={fetchAppointments}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.25)",
            background: "transparent",
            color: "inherit",
            cursor: "pointer",
          }}
        >
          Refresh
        </button>

        {loading && <span style={{ opacity: 0.7 }}>Loading…</span>}
      </div>

      <div style={{ borderTop: "1px solid rgba(255,255,255,0.12)", paddingTop: 14 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "220px 240px 140px 140px 1fr",
            gap: 12,
            fontWeight: 600,
            marginBottom: 10,
            opacity: 0.95,
          }}
        >
          <div>Patient</div>
          <div>Starts at</div>
          <div>Status</div>
          <div>Checked-in</div>
          <div>Actions</div>
        </div>

        {sorted.map((a) => {
          const status = normalizeStatus(a.status);
          const checkedIn = Boolean(a.checked_in_at);

          // Disable buttons that should never be used in that state (less noise)
          const isCanceled = status === "canceled";
          const isNoShow = status === "no_show";

          return (
            <div
              key={a.id}
              style={{
                display: "grid",
                gridTemplateColumns: "220px 240px 140px 140px 1fr",
                gap: 12,
                padding: "10px 0",
                borderTop: "1px solid rgba(255,255,255,0.08)",
                alignItems: "center",
              }}
            >
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {a.patient_name || "(no name)"}
              </div>

              <div>{formatLocal(a.starts_at)}</div>

              <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
                {status}
              </div>

              <div>{checkedIn ? "Yes" : "No"}</div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  onClick={() => actionCheckIn(a.id)}
                  disabled={isCanceled || isNoShow || checkedIn}
                  style={btnStyle(isCanceled || isNoShow || checkedIn)}
                >
                  Check-in
                </button>

                <button
                  onClick={() => actionSetStatus(a.id, "late")}
                  disabled={isCanceled || isNoShow || checkedIn}
                  style={btnStyle(isCanceled || isNoShow || checkedIn)}
                >
                  Mark late
                </button>

                <button
                  onClick={() => actionSetStatus(a.id, "no_show")}
                  disabled={isCanceled || isNoShow || checkedIn}
                  style={btnStyle(isCanceled || isNoShow || checkedIn)}
                >
                  Mark no-show
                </button>

                <button
                  onClick={() => actionSetStatus(a.id, "canceled")}
                  disabled={isCanceled || isNoShow || checkedIn}
                  style={btnStyle(isCanceled || isNoShow || checkedIn)}
                >
                  Cancel
                </button>

                <button
                  onClick={() => actionExcuse(a.id)}
                  disabled={!isNoShow}
                  style={btnStyle(!isNoShow)}
                >
                  Excuse
                </button>
              </div>
            </div>
          );
        })}

        {sorted.length === 0 && !loading && (
          <div style={{ opacity: 0.7, paddingTop: 12 }}>No appointments yet.</div>
        )}
      </div>
    </div>
  );
}

function btnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.25)",
    background: "transparent",
    color: "inherit",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.4 : 1,
  };
}
