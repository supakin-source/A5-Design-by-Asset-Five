"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Folds a duplicate Project (e.g. from the mid-conversation fragmentation
// bug — docs/AI_POLICY.md §1.2a) into the project currently being viewed.
export function MergeButton({ primaryProjectId, duplicateProjectId }: { primaryProjectId: string; duplicateProjectId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function merge() {
    if (!adminPassword) {
      setError("ต้องกรอกรหัสผ่านยืนยันก่อน");
      return;
    }
    if (!window.confirm("ยืนยัน merge งานนี้เข้ากับงานที่กำลังดูอยู่? บทสนทนาและการแจ้งเตือนจะถูกย้ายมา แล้วงานนี้จะถูกลบ")) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard/projects/${primaryProjectId}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duplicateProjectId, adminPassword }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "merge ไม่สำเร็จ");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="link-button" onClick={() => setOpen(true)}>
        merge เข้ากับงานนี้
      </button>
    );
  }

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <input
        type="password"
        placeholder="รหัสผ่านยืนยัน"
        style={{ width: 140 }}
        value={adminPassword}
        onChange={(e) => setAdminPassword(e.target.value)}
      />
      <button className="primary" onClick={merge} disabled={busy}>
        ยืนยัน merge
      </button>
      <button className="link-button" onClick={() => setOpen(false)} disabled={busy}>
        ยกเลิก
      </button>
      {error && <span style={{ color: "var(--status-critical)", fontSize: 12 }}>{error}</span>}
    </span>
  );
}
