"use client";

import { useEffect, useMemo, useState } from "react";

type Appointment = {
  id: string;
  patient_name: string;
  starts_at: string;
  status: string;
  no_show_excused: boolean | null;
  no_show_fee_pending: boolean | null;
  no_show_fee_charged: boolean | null;
  no_show_fee_processing_at: string | null;
  no_show_fee_attempt_count: number | null;
  no_show_fee_last_error: string | null;
};

type View = "pending" | "processing" | "failed" | "charged" | "all";

function toLocal(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function feeState(a: Appointment) {
  if (a.no_show_fee_charged) return "charged";
  if (a.no_show_fee_processing_at) return "processing";
  if (a.no_show_fee_pending) {
    if (a.no_show_fee_last_error) return "failed";
    return "pending";
  }
  return "-";
}

export default function BillingClient() {
  const [view, setView] = useState<View>("pending");
  const [rows, setRows] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/billing?view=${view}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || `Failed (${res.status})`);
        setRows([]);
        return;
      }
      setRows(Array.isArray(json?.appointments) ? json.appointments : []);
    } catch (e: any) {
      setError(e?.message || "Failed to load");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  async function retry(id: string) {
    setError(null);
    try {
      const res = await fetch("/api/billing/retry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || `Retry failed (${res.status})`);
        return;
      }
      await load();
    } catch (e: any) {
      setError(e?.message || "Retry failed");
    }
  }

  const tabs: { key: View; label: string }[] = useMemo(
    () => [
      { key: "pending", label: "Pending" },
      { key: "processing", label: "Processing" },
      { key: "failed", label: "Failed" },
      { key: "charged", label: "Charged" },
      { key: "all", label: "All" },
    ],
    []
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setView(t.key)}
            style={{
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid #333",
              background: view === t.key ? "#111" : "transparent",
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}

        <button
          onClick={load}
          disabled={loading}
          style={{
            marginLeft: "auto",
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid #333",
            background: "transparent",
            cursor: "pointer",
          }}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && <div style={{ marginBottom: 10, color: "tomato" }}>{error}</div>}

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #222" }}>
            <th style={{ padding: 10 }}>Patient</th>
            <th style={{ padding: 10 }}>Starts at</th>
            <th style={{ padding: 10 }}>Status</th>
            <th style={{ padding: 10 }}>Fee state</th>
            <th style={{ padding: 10 }}>Attempts</th>
            <th style={{ padding: 10 }}>Last error</th>
            <th style={{ padding: 10 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const attempts = typeof a.no_show_fee_attempt_count === "number" ? a.no_show_fee_attempt_count : 0;
            const canRetry = feeState(a) === "failed" || feeState(a) === "pending";
            return (
              <tr key={a.id} style={{ borderBottom: "1px solid #222" }}>
                <td style={{ padding: 10 }}>{a.patient_name}</td>
                <td style={{ padding: 10, whiteSpace: "nowrap" }}>{toLocal(a.starts_at)}</td>
                <td style={{ padding: 10 }}>{a.status}</td>
                <td style={{ padding: 10 }}>{feeState(a)}</td>
                <td style={{ padding: 10 }}>{attempts || "-"}</td>
                <td style={{ padding: 10 }}>{a.no_show_fee_last_error || "-"}</td>
                <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                  <button
                    onClick={() => retry(a.id)}
                    disabled={!canRetry}
                    style={{
                      padding: "6px 10px",
                      borderRadius: 8,
                      border: "1px solid #333",
                      background: "transparent",
                      cursor: canRetry ? "pointer" : "not-allowed",
                      opacity: canRetry ? 1 : 0.5,
                    }}
                    title={!canRetry ? "Nothing to retry" : "Requeue for charging"}
                  >
                    Retry
                  </button>
                </td>
              </tr>
            );
          })}

          {rows.length === 0 && (
            <tr>
              <td style={{ padding: 10 }} colSpan={7}>
                No rows for this view.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div style={{ marginTop: 12, opacity: 0.8 }}>
        Notes: “Retry” just re-queues the item (clears processing/error). The cron pipeline will pick it up.
      </div>
    </div>
  );
}
