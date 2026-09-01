"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ProjectStatus } from "@prisma/client";
import { PROJECT_STATUS_LABEL, formatDateTime } from "@/lib/format";

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
  createdAt: Date;
}

const FIELD_LABELS: Array<[keyof Omit<EditableProject, "id" | "status" | "createdAt">, string]> = [
  ["displayName", "ชื่อลูกค้า"],
  ["phone", "เบอร์ติดต่อ"],
  ["projectType", "ประเภทงาน"],
  ["projectDetail", "รายละเอียดงาน"],
  ["budgetRange", "งบประมาณ"],
  ["location", "พื้นที่/ทำเล"],
  ["timeline", "กรอบเวลา"],
  ["contactNote", "ช่วงเวลาที่สะดวกติดต่อ"],
];

// Renders the "ข้อมูลลูกค้า" card in either view mode or edit mode — one card
// that swaps its own content in place, rather than opening a second card
// alongside it.
export function EditProject({ project }: { project: EditableProject }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(project);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEditing() {
    setForm(project);
    setError(null);
    setEditing(true);
  }

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
      setEditing(false);
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

  if (!editing) {
    return (
      <div className="card">
        <h2>ข้อมูลลูกค้า</h2>
        <p className="sub">ข้อมูลที่บอทเก็บได้จากบทสนทนา (งานนี้)</p>
        <div className="table-wrap">
          <table>
            <tbody>
              {FIELD_LABELS.map(([key, label]) => (
                <tr key={key}>
                  <th style={{ width: 180 }}>{label}</th>
                  <td style={{ whiteSpace: "normal" }}>{project[key] || "—"}</td>
                </tr>
              ))}
              <tr>
                <th style={{ width: 180 }}>สถานะ</th>
                <td>{PROJECT_STATUS_LABEL[project.status]}</td>
              </tr>
              <tr>
                <th style={{ width: 180 }}>เข้ามาเมื่อ</th>
                <td>{formatDateTime(project.createdAt)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {error && <p style={{ color: "var(--status-critical)" }}>{error}</p>}
        <div style={{ marginTop: 12 }}>
          <button className="link-button" onClick={startEditing}>
            แก้ไขข้อมูล
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
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
              <th style={{ width: 180 }}>สถานะ</th>
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
            setEditing(false);
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
