"use client";

export const dynamic = "force-dynamic";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type AppointmentRow = {
  id: string;
  created_at: string;
  user_id: string;
  patient_name: string | null;
  starts_at: string | null;
  status: string | null;
  canceled_at: string | null;
  no_show_fee_charged: boolean | null;
};

function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const min = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

export default function DashboardPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  // Form
  const [patientName, setPatientName] = useState("");
  const [startsAt, setStartsAt] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 60);
    return toLocalInputValue(d);
  });

  const canCreate = useMemo(() => {
    return Boolean(userId) && patientName.trim().length > 0 && Boolean(startsAt);
  }, [userId, patientName, startsAt]);

  useEffect(() => {
    async function load() {
      setErrorMsg(null);
      setOkMsg(null);

      const { data, error } = await supabase.auth.getSession();
      if (error) {
        setErrorMsg(error.message);
        setLoading(false);
        return;
      }

      const session = data.session;
      if (!session) {
        router.replace("/login");
        return;
      }

      setEmail(session.user.email ?? null);
      setUserId(session.user.id);
      setLoading(false);

      await fetchAppointments(session.user.id);
    }

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function fetchAppointments(uid: string) {
    setErrorMsg(null);
    const { data, error } = await supabase
      .from("appointments")
      .select("*")
      .order("starts_at", { ascending: true });

    if (error) {
      setErrorMsg(error.message);
      return;
    }

    // RLS ya filtra por user_id, pero dejamos el uid por claridad mental.
    setAppointments((data ?? []) as AppointmentRow[]);
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  async function createAppointment() {
    setErrorMsg(null);
    setOkMsg(null);

    if (!userId) return;

    const iso = new Date(startsAt).toISOString();

    const { error } = await supabase.from("appointments").insert({
      user_id: userId,
      patient_name: patientName.trim(),
      starts_at: iso,
      status: "scheduled",
      no_show_fee_charged: false,
      canceled_at: null,
    });

    if (error) {
      setErrorMsg(error.message);
      return;
    }

    setOkMsg("Appointment created.");
    setPatientName("");
    await fetchAppointments(userId);
  }

  async function setStatus(id: string, nextStatus: "scheduled" | "canceled" | "completed" | "no_show") {
    setErrorMsg(null);
    setOkMsg(null);

    const patch: Partial<AppointmentRow> & { status: string } = {
      status: nextStatus,
    };

    if (nextStatus === "canceled") {
      patch.canceled_at = new Date().toISOString();
    } else {
      patch.canceled_at = null;
    }

    const { error } = await supabase.from("appointments").update(patch).eq("id", id);

    if (error) {
      setErrorMsg(error.message);
      return;
    }

    setOkMsg(`Updated to "${nextStatus}".`);
    if (userId) await fetchAppointments(userId);
  }

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 900, margin: "40px auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Dashboard</h1>
          <p style={{ marginTop: 8, opacity: 0.85 }}>Signed in as: {email}</p>
        </div>
        <button onClick={signOut}>Sign out</button>
      </div>

      <hr style={{ margin: "24px 0" }} />

      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Create appointment</h2>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 260px 140px", gap: 12, alignItems: "end" }}>
        <div>
          <label style={{ display: "block", fontSize: 12, opacity: 0.85, marginBottom: 6 }}>Patient name</label>
          <input
            value={patientName}
            onChange={(e) => setPatientName(e.target.value)}
            placeholder="e.g. Ana García"
            style={{ width: "100%", padding: 10 }}
          />
        </div>

        <div>
          <label style={{ display: "block", fontSize: 12, opacity: 0.85, marginBottom: 6 }}>Starts at</label>
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            style={{ width: "100%", padding: 10 }}
          />
        </div>

        <button onClick={createAppointment} disabled={!canCreate} style={{ padding: 10 }}>
          Create
        </button>
      </div>

      {(errorMsg || okMsg) && (
        <div style={{ marginTop: 12 }}>
          {errorMsg && <p style={{ margin: 0, color: "tomato" }}>{errorMsg}</p>}
          {okMsg && <p style={{ margin: 0, color: "lightgreen" }}>{okMsg}</p>}
        </div>
      )}

      <hr style={{ margin: "24px 0" }} />

      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Appointments</h2>

      {appointments.length === 0 ? (
        <p style={{ opacity: 0.85 }}>No appointments yet. Create one above.</p>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {appointments.map((a) => (
            <div
              key={a.id}
              style={{
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 12,
                padding: 12,
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 12,
                alignItems: "center",
              }}
            >
              <div>
                <div style={{ fontWeight: 700 }}>{a.patient_name ?? "(no name)"}</div>
                <div style={{ opacity: 0.8, marginTop: 4 }}>
                  {a.starts_at ? new Date(a.starts_at).toLocaleString() : "No date"} ·{" "}
                  <span style={{ textTransform: "lowercase" }}>{a.status ?? "scheduled"}</span>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button onClick={() => setStatus(a.id, "completed")}>Completed</button>
                <button onClick={() => setStatus(a.id, "no_show")}>No-show</button>
                <button onClick={() => setStatus(a.id, "canceled")}>Canceled</button>
                <button onClick={() => setStatus(a.id, "scheduled")}>Reset</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
