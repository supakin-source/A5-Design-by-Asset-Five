"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Folds a duplicate Project (e.g. from the mid-conversation fragmentation
// bug — docs/AI_POLICY.md §1.2a) into the project currently being viewed.
export function MergeButton({ primaryProjectId, duplicateProjectId }: { primaryProjectId: string; duplicateProjectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function merge() {
    if (
      !window.confirm(
        "รวมงานนี้เข้ากับงานที่กำลังดูอยู่? บทสนทนาและการแจ้งเตือนจะถูกย้ายมา แล้วงานนี้จะถูกลบ",
      )
    ) {
      return;
    }
    const adminPassword = window.prompt("กรอกรหัสผ่านเพื่อยืนยันการทำรายการ");
    if (adminPassword === null) return; // cancelled
    if (!adminPassword) {
      setError("ต้องกรอกรหัสผ่านยืนยันก่อน");
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
      if (!res.ok) throw new Error(body.error ?? "รวมงานไม่สำเร็จ");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <button className="link-button" onClick={merge} disabled={busy}>
        รวมกับงานนี้
      </button>
      {error && <span style={{ color: "var(--status-critical)", fontSize: 12 }}>{error}</span>}
    </span>
  );
}
