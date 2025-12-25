"use client";

import { useEffect, useState } from "react";

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [graceMinutes, setGraceMinutes] = useState<number>(10);
  const [msg, setMsg] = useState<string>("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setMsg("");
      const res = await fetch("/api/settings");
      const json = await res.json();
      if (!res.ok) {
        setMsg(json.error || "Error loading settings");
      } else {
        setGraceMinutes(json.grace_minutes);
      }
      setLoading(false);
    })();
  }, []);

  async function save() {
    setSaving(true);
    setMsg("");
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grace_minutes: graceMinutes }),
    });
    const json = await res.json();
    if (!res.ok) setMsg(json.error || "Error saving");
    else setMsg("Guardado ✅");
    setSaving(false);
  }

  if (loading) return <div style={{ padding: 24 }}>Cargando…</div>;

  return (
    <div style={{ padding: 24, maxWidth: 480 }}>
      <h1>Settings</h1>

      <label style={{ display: "block", marginTop: 16 }}>
        Grace minutes
      </label>
      <input
        type="number"
        value={graceMinutes}
        min={0}
        max={180}
        onChange={(e) => setGraceMinutes(Number(e.target.value))}
        style={{ width: "100%", padding: 8, marginTop: 8 }}
      />

      <button
        onClick={save}
        disabled={saving}
        style={{ marginTop: 16, padding: 10, width: "100%" }}
      >
        {saving ? "Guardando…" : "Guardar"}
      </button>

      {msg && <div style={{ marginTop: 12 }}>{msg}</div>}
    </div>
  );
}
