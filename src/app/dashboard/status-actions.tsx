"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ProjectStatus } from "@prisma/client";

// Which moves make sense from where. A closed job can be reopened in case it
// was closed by mistake; everything else moves forward.
const NEXT_STEPS: Record<ProjectStatus, Array<{ to: ProjectStatus; label: string; primary?: boolean }>> = {
  [ProjectStatus.NEW]: [
    { to: ProjectStatus.CONTACTED, label: "ติดต่อแล้ว", primary: true },
    { to: ProjectStatus.CLOSED, label: "ปิดงาน" },
  ],
  [ProjectStatus.HANDED_OFF]: [
    { to: ProjectStatus.CONTACTED, label: "ติดต่อแล้ว", primary: true },
    { to: ProjectStatus.CLOSED, label: "ปิดงาน" },
  ],
  [ProjectStatus.CONTACTED]: [{ to: ProjectStatus.CLOSED, label: "ปิดงาน", primary: true }],
  [ProjectStatus.CLOSED]: [{ to: ProjectStatus.CONTACTED, label: "เปิดงานอีกครั้ง" }],
};

export function StatusActions({ projectId, status }: { projectId: string; status: ProjectStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function move(to: ProjectStatus) {
    if (to === ProjectStatus.CLOSED && !window.confirm("ปิดงานนี้? ถ้าลูกค้าทักมาอีกครั้ง ระบบจะเปิดเป็นงานใหม่ให้ทันที")) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard/projects/${projectId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: to }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "บันทึกไม่สำเร็จ");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", whiteSpace: "nowrap" }}>
      {NEXT_STEPS[status].map((step) => (
        <button key={step.to} className="link-button" onClick={() => move(step.to)} disabled={busy}>
          {step.label}
        </button>
      ))}
      {error && <span style={{ color: "var(--status-critical)", fontSize: 12 }}>{error}</span>}
    </span>
  );
}
