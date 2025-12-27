"use client";

import { useEffect, useState } from "react";

type Settings = {
  grace_minutes: number;
  late_cancel_window_minutes: number;
  no_show_fee_cents: number;
  auto_charge_enabled: boolean;
  currency: "EUR" | "USD" | "GBP";
};

export default function SettingsClient() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [form, setForm] = useState<Settings>({
    grace_minutes: 10,
    late_cancel_window_minutes: 60,
    no_show_fee_cents: 0,
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

    setForm({
      grace_minutes: Number(j.grace_minutes ?? 10),
      late_cancel_window_minutes: Number(j.late_cancel_window_minutes ?? 60),
      no_show_fee_cents: Number(j.no_show_fee_cents ?? 0),
      auto_charge_enabled: Boolean(j.auto_charge_enabled ?? false),
      currency: (j.currency ?? "EUR") as Settings["currency"],
    });

    setLoading(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setOk(null);

    const r = await fetch("/api/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setError(j?.error ?? "Failed to save");
      setSaving(false);
      return;
    }

    // snap back to server-normalized currency, in case someone tampered
    if (j?.currency) {
      setForm((f) => ({ ...f, currency: j.currency }));
    }

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
        onChange={(e) => setForm({ ...form, grace_minutes: Number(e.target.value) })}
        type="number"
        min={0}
        max={240}
        style={{ width: "100%", padding: 10 }}
      />

      <label style={{ display: "block", marginTop: 14 }}>Late cancel window (minutes)</label>
      <input
        value={form.late_cancel_window_minutes}
        onChange={(e) => setForm({ ...form, late_cancel_window_minutes: Number(e.target.value) })}
        type="number"
        min={0}
        max={10080}
        style={{ width: "100%", padding: 10 }}
      />

      <label style={{ display: "block", marginTop: 14 }}>No-show fee (cents)</label>
      <input
        value={form.no_show_fee_cents}
        onChange={(e) => setForm({ ...form, no_show_fee_cents: Number(e.target.value) })}
        type="number"
        min={0}
        max={1000000}
        style={{ width: "100%", padding: 10 }}
      />

      <label style={{ display: "block", marginTop: 14 }}>
        <input
          checked={form.auto_charge_enabled}
          onChange={(e) => setForm({ ...form, auto_charge_enabled: e.target.checked })}
          type="checkbox"
          style={{ marginRight: 8 }}
        />
        Auto-charge enabled
      </label>

      <label style={{ display: "block", marginTop: 14 }}>Currency</label>
      <select
        value={form.currency}
        onChange={(e) => setForm({ ...form, currency: e.target.value as Settings["currency"] })}
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
