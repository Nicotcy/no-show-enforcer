"use client";

import { useEffect, useState } from "react";

type ClinicSettings = {
  grace_minutes: number;
  late_cancel_window_minutes: number;
  no_show_fee_cents: number;
  auto_charge_enabled: boolean;
  currency: string;
};

export default function SettingsClient() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [settings, setSettings] = useState<ClinicSettings | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setMsg(null);

      const res = await fetch("/api/settings");
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setMsg(data?.error ?? "Failed to load settings");
        setLoading(false);
        return;
      }

      setSettings(data);
      setLoading(false);
    }

    load();
  }, []);

  async function save() {
    if (!settings) return;
    setSaving(true);
    setMsg(null);

    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });

    const data = await res.json().catch(() => ({}));

    setSaving(false);

    if (!res.ok) {
      setMsg(data?.error ?? "Failed to save settings");
      return;
    }

    setMsg("Saved");
  }

  if (loading) return <p>Loading…</p>;
  if (!settings) return <p>{msg ?? "No settings found"}</p>;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <label style={{ display: "grid", gap: 6 }}>
        Grace minutes
        <input
          type="number"
          value={settings.grace_minutes}
          onChange={(e) =>
            setSettings({ ...settings, grace_minutes: Number(e.target.value) })
          }
          style={{ padding: 10, border: "1px solid #333", borderRadius: 8 }}
        />
      </label>

      <label style={{ display: "grid", gap: 6 }}>
        Late cancel window (minutes)
        <input
          type="number"
          value={settings.late_cancel_window_minutes}
          onChange={(e) =>
            setSettings({
              ...settings,
              late_cancel_window_minutes: Number(e.target.value),
            })
          }
          style={{ padding: 10, border: "1px solid #333", borderRadius: 8 }}
        />
      </label>

      <label style={{ display: "grid", gap: 6 }}>
        No-show fee (cents)
        <input
          type="number"
          value={settings.no_show_fee_cents}
          onChange={(e) =>
            setSettings({
              ...settings,
              no_show_fee_cents: Number(e.target.value),
            })
          }
          style={{ padding: 10, border: "1px solid #333", borderRadius: 8 }}
        />
      </label>

      <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <input
          type="checkbox"
          checked={settings.auto_charge_enabled}
          onChange={(e) =>
            setSettings({ ...settings, auto_charge_enabled: e.target.checked })
          }
        />
        Auto-charge enabled
      </label>

      <label style={{ display: "grid", gap: 6 }}>
        Currency
        <input
          value={settings.currency}
          onChange={(e) =>
            setSettings({ ...settings, currency: e.target.value })
          }
          style={{ padding: 10, border: "1px solid #333", borderRadius: 8 }}
        />
      </label>

      <button
        onClick={save}
        disabled={saving}
        style={{
          padding: 10,
          borderRadius: 8,
          border: "1px solid #333",
          cursor: "pointer",
          background: "transparent",
        }}
      >
        {saving ? "Saving…" : "Save"}
      </button>

      {msg && <p style={{ margin: 0 }}>{msg}</p>}
    </div>
  );
}
