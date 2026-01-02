"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function AppNav() {
  const router = useRouter();

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        alignItems: "center",
        padding: 16,
        borderBottom: "1px solid #333",
      }}
    >
      <Link href="/dashboard">Dashboard</Link>
      <Link href="/settings">Settings</Link>
      <Link href="/billing">Billing</Link>

      <button
        onClick={signOut}
        style={{
          marginLeft: "auto",
          padding: "8px 10px",
          borderRadius: 8,
          border: "1px solid #333",
          background: "transparent",
          cursor: "pointer",
        }}
      >
        Sign out
      </button>
    </div>
  );
}
