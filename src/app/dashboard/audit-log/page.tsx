import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const ACTION_LABEL: Record<string, string> = {
  update: "แก้ไข",
  delete: "ลบ",
  merge: "รวมงาน",
  status: "เปลี่ยนสถานะ",
};

export default async function AuditLogPage() {
  const entries = await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 200 });

  // Name the job the way staff know it. A deleted or merged-away project has
  // neither a name nor a page to link to any more, so those rows say so
  // instead of showing a dangling id.
  const targets = await prisma.project.findMany({
    where: { id: { in: [...new Set(entries.map((e) => e.targetId))] } },
    include: { lead: true },
  });
  const targetById = new Map(targets.map((p) => [p.id, p]));

  return (
    <>
      <h1 style={{ marginTop: 0 }}>ประวัติการแก้ไข</h1>
      <div className="card">
        <p className="sub">
          200 รายการล่าสุด · ใครแก้อะไร เมื่อไหร่ (บันทึกอัตโนมัติทุกครั้งที่ทีมงานแก้ไข ลบ รวมงาน หรือเปลี่ยนสถานะ)
        </p>
        {entries.length === 0 ? (
          <p className="empty">ยังไม่มีประวัติการแก้ไข</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>เวลา</th>
                  <th>ผู้ใช้</th>
                  <th>การกระทำ</th>
                  <th>งาน</th>
                  <th>รายละเอียด</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const target = targetById.get(entry.targetId);
                  return (
                    <tr key={entry.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{formatDateTime(entry.createdAt)}</td>
                      <td>{entry.username}</td>
                      <td>
                        <span className="badge">{ACTION_LABEL[entry.action] ?? entry.action}</span>
                      </td>
                      <td>
                        {target ? (
                          <Link href={`/dashboard/leads/${target.id}`}>
                            {target.lead.displayName ?? "ไม่ระบุชื่อ"}
                            {target.projectType ? ` · ${target.projectType}` : ""}
                          </Link>
                        ) : (
                          <span style={{ color: "var(--text-muted)" }}>ลบ/รวมไปแล้ว</span>
                        )}
                      </td>
                      <td style={{ whiteSpace: "normal", maxWidth: 460 }}>{entry.detail}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
