"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/dashboard";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
      <div>
        <h1 style={{ fontSize: 18, margin: 0 }}>A5 Design Dashboard</h1>
        <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "2px 0 0" }}>สำหรับทีมงานเท่านั้น</p>
      </div>

      <label>
        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>ชื่อผู้ใช้</span>
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
      </label>

      <label>
        <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>รหัสผ่าน</span>
        <div className="field-password">
          <input
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          {/* Lets the user check what they typed before submitting — a wrong
              password is by far the most common reason a login fails. */}
          <button
            type="button"
            className="reveal"
            onClick={() => setShowPassword((v) => !v)}
            aria-pressed={showPassword}
          >
            {showPassword ? "ซ่อน" : "แสดง"}
          </button>
        </div>
      </label>

      {error && <div className="error">{error}</div>}

      <button className="primary" type="submit" disabled={busy}>
        {busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
      </button>
    </form>
  );
}
