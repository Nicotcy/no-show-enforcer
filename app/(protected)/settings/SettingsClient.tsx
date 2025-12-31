"use client";

import { useEffect, useState } from "react";

type Currency = "EUR" | "USD" | "GBP";

type Settings = {
  grace_minutes: number;
  late_cancel_window_minutes: number;
  no_show_fee_cents: number;
  auto_charge_enabled: boolean;
  currency: Currency;
};

// UI form uses strings for number fields to allow empty input
type SettingsForm = {
  grace_minutes: string;
  late_cancel_window_minutes: string;
  no_show_fee_cents: string;
  auto_charge_enabled: boolean;
  currency: Currency;
};

function numToField(n: number) {
  // show empty when 0, so user doesn't have to "fight" the 0
  if (!Number.isFinite(n) || n === 0) return "";
  return String(n);
}

function clampInt(value: string, min: number, max: number, fallback: number) {
  const t = value.trim();
  if (!t) return fallback;
  const n = Math.floor(Number(t));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export default function SettingsClient() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [form, setForm] = useState<SettingsForm>({
    grace_minutes: "10",
    late_cancel_window_minutes: "60",
    no_show_fee_cents: "",
    auto_charge_enabled: false,
    currency: "EUR",
  });

  async function load() {
    setLoading(true);
    setError(null);
    setOk(null);

    const r = await fetch("/api/settings", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setError(j?.error ?? "Failed to load settings");
      setLoading(false);
      return;
    }

    const grace = Number(j.grace_minutes ?? 10);
    const windowMins = Number(j.late_cancel_window_minutes ?? 60);
    const fee = Number(j.no_show_fee_cents ?? 0);

    setForm({
      grace_minutes: numToField(grace),
      late_cancel_window_minutes: numToField(windowMins),
      no_show_fee_cents: numToField(fee),
      auto_charge_enabled: Boolean(j.auto_charge_enabled ?? false),
      currency: (j.currency ?? "EUR") as Currency,
    });

    setLoading(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setOk(null);

    // Convert UI fields -> Settings numbers (empty becomes 0)
    const payload: Settings = {
      grace_minutes: clampInt(form.grace_minutes, 0, 240, 10),
      late_cancel_window_minutes: clampInt(
        form.late_cancel_window_minutes,
        0,
        10080,
        60
      ),
      no_show_fee_cents: clampInt(form.no_show_fee_cents, 0, 1_000_000, 0),
      auto_charge_enabled: Boolean(form.auto_charge_enabled),
      currency: form.currency,
    };

    const r = await fetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setError(j?.error ?? "Failed to save");
      setSaving(false);
      return;
    }

    // snap back to server-normalized currency, in case someone tampered
    const normalizedCurrency = (j?.currency ?? payload.currency) as Currency;

    // Also normalize fields after save (keeps things tidy)
    setForm((f) => ({
      ...f,
      grace_minutes: numToField(payload.grace_minutes),
      late_cancel_window_minutes: numToField(payload.late_cancel_window_minutes),
      no_show_fee_cents: numToField(payload.no_show_fee_cents),
      currency: normalizedCurrency,
    }));

    setOk("Saved");
    setSaving(false);
  }

  useEffect(() => {
    load();
  }, []);

  if (loading) return <div style={{ padding: 24 }}>Loading...</div>;

  return (
    <div style={{ padding: 24, maxWidth: 520 }}>
      <h2 style={{ marginBottom: 12 }}>Settings</h2>

      {error && (
        <div style={{ marginBottom: 12, padding: 10, border: "1px solid #a33" }}>
          {error}
        </div>
      )}
      {ok && (
        <div style={{ marginBottom: 12, padding: 10, border: "1px solid #3a3" }}>
          {ok}
        </div>
      )}

      <label style={{ display: "block", marginTop: 14 }}>Grace minutes</label>
      <input
        value={form.grace_minutes}
        onChange={(e) =>
          setForm({ ...form, grace_minutes: e.target.value })
        }
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) =>
          setForm((f) => ({
            ...f,
            grace_minutes: numToField(clampInt(e.target.value, 0, 240, 10)),
          }))
        }
        inputMode="numeric"
        pattern="[0-9]*"
        placeholder="10"
        style={{ width: "100%", padding: 10 }}
      />

      <label style={{ display: "block", marginTop: 14 }}>
        Late cancel window (minutes)
      </label>
      <input
        value={form.late_cancel_window_minutes}
        onChange={(e) =>
          setForm({ ...form, late_cancel_window_minutes: e.target.value })
        }
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) =>
          setForm((f) => ({
            ...f,
            late_cancel_window_minutes: numToField(
              clampInt(e.target.value, 0, 10080, 60)
            ),
          }))
        }
        inputMode="numeric"
        pattern="[0-9]*"
        placeholder="60"
        style={{ width: "100%", padding: 10 }}
      />

      <label style={{ display: "block", marginTop: 14 }}>No-show fee (cents)</label>
      <input
        value={form.no_show_fee_cents}
        onChange={(e) =>
          setForm({ ...form, no_show_fee_cents: e.target.value })
        }
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) =>
          setForm((f) => ({
            ...f,
            no_show_fee_cents: numToField(
              clampInt(e.target.value, 0, 1_000_000, 0)
            ),
          }))
        }
        inputMode="numeric"
        pattern="[0-9]*"
        placeholder="0"
        style={{ width: "100%", padding: 10 }}
      />

      <label style={{ display: "block", marginTop: 14 }}>
        <input
          checked={form.auto_charge_enabled}
          onChange={(e) =>
            setForm({ ...form, auto_charge_enabled: e.target.checked })
          }
          type="checkbox"
          style={{ marginRight: 8 }}
        />
        Auto-charge enabled
      </label>

      <label style={{ display: "block", marginTop: 14 }}>Currency</label>
      <select
        value={form.currency}
        onChange={(e) =>
          setForm({ ...form, currency: e.target.value as Currency })
        }
        style={{ width: "100%", padding: 10 }}
      >
        <option value="EUR">EUR</option>
        <option value="USD">USD</option>
        <option value="GBP">GBP</option>
      </select>

      <button
        onClick={save}
        disabled={saving}
        style={{ marginTop: 18, padding: "10px 14px", width: "100%" }}
      >
        {saving ? "Saving..." : "Save"}
      </button>
    </div>
  );
}
