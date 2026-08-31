"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/dashboard";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    setBusy(false);
    if (res.ok) {
      router.replace(next);
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setError(data.error ?? "เข้าสู่ระบบไม่สำเร็จ");
  }

  return (
    <form className="login" onSubmit={onSubmit}>
      <h1 style={{ fontSize: 18, margin: 0 }}>A5 Design — Dashboard</h1>
      <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>สำหรับทีมงานภายในเท่านั้น</p>
      <input
        aria-label="ชื่อผู้ใช้"
        placeholder="ชื่อผู้ใช้"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        autoComplete="username"
      />
      <input
        aria-label="รหัสผ่าน"
        type="password"
        placeholder="รหัสผ่าน"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
      />
      {error && <div className="error">{error}</div>}
      <button className="primary" type="submit" disabled={busy}>
        {busy ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
      </button>
    </form>
  );
}
