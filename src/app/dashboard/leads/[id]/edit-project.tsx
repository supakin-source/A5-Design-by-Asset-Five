"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ProjectStatus } from "@prisma/client";
import { PROJECT_STATUS_LABEL } from "@/lib/format";

interface EditableProject {
  id: string;
  displayName: string;
  phone: string;
  projectType: string;
  projectDetail: string;
  budgetRange: string;
  location: string;
  timeline: string;
  contactNote: string;
  status: ProjectStatus;
}

const FIELD_LABELS: Array<[keyof Omit<EditableProject, "id" | "status">, string]> = [
  ["displayName", "ชื่อลูกค้า"],
  ["phone", "เบอร์ติดต่อ"],
  ["projectType", "ประเภทงาน"],
  ["projectDetail", "รายละเอียดงาน"],
  ["budgetRange", "งบประมาณ"],
  ["location", "พื้นที่/ทำเล"],
  ["timeline", "กรอบเวลา"],
  ["contactNote", "ช่วงเวลาที่สะดวกติดต่อ"],
];

export function EditProject({ project }: { project: EditableProject }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(project);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const adminPassword = window.prompt("กรอกรหัสผ่านยืนยันการบันทึกข้อมูล:");
    if (adminPassword === null) return; // cancelled
    if (!adminPassword) {
      setError("ต้องกรอกรหัสผ่านยืนยันก่อน");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, adminPassword }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "แก้ไขไม่สำเร็จ");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const adminPassword = window.prompt(
      'พิมพ์รหัสผ่านยืนยันเพื่อ "ลบงานนี้ถาวร" — บทสนทนาและการแจ้งเตือนทั้งหมดจะถูกลบไปด้วย กู้คืนไม่ได้:',
    );
    if (adminPassword === null) return; // cancelled
    if (!adminPassword) {
      setError("ต้องกรอกรหัสผ่านยืนยันก่อน");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard/projects/${project.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminPassword }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "ลบไม่สำเร็จ");
      router.push("/dashboard/leads");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="link-button" onClick={() => setOpen(true)}>
        แก้ไขข้อมูล
      </button>
    );
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h2>แก้ไขข้อมูล</h2>
      <p className="sub">กด "บันทึก" หรือ "ลบงานนี้ถาวร" จะมีป็อปอัพให้กรอกรหัสผ่านยืนยันก่อนดำเนินการ</p>
      <div className="table-wrap">
        <table>
          <tbody>
            {FIELD_LABELS.map(([key, label]) => (
              <tr key={key}>
                <th style={{ width: 180 }}>{label}</th>
                <td>
                  <input
                    style={{ width: "100%" }}
                    value={form[key]}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  />
                </td>
              </tr>
            ))}
            <tr>
              <th>สถานะ</th>
              <td>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value as ProjectStatus })}
                >
                  {Object.values(ProjectStatus).map((status) => (
                    <option key={status} value={status}>
                      {PROJECT_STATUS_LABEL[status]}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {error && <p style={{ color: "var(--status-critical)" }}>{error}</p>}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className="primary" onClick={save} disabled={busy}>
          บันทึก
        </button>
        <button
          className="link-button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={busy}
        >
          ยกเลิก
        </button>
        <button className="danger" style={{ marginLeft: "auto" }} onClick={remove} disabled={busy}>
          ลบงานนี้ถาวร
        </button>
      </div>
    </div>
  );
}
