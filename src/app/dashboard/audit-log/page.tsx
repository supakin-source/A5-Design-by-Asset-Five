import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const ACTION_LABEL: Record<string, string> = {
  update: "แก้ไข",
  delete: "ลบ",
  merge: "merge",
};

export default async function AuditLogPage() {
  const entries = await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 200 });

  // A deleted/merged-away Project has no page to link to any more; only
  // link entries whose target still exists.
  const targetIds = [...new Set(entries.map((e) => e.targetId))];
  const existing = new Set(
    (await prisma.project.findMany({ where: { id: { in: targetIds } }, select: { id: true } })).map((p) => p.id),
  );

  return (
    <>
      <h1 style={{ fontSize: 20, marginTop: 0 }}>ประวัติการแก้ไขข้อมูล</h1>
      <div className="card">
        <h2>การแก้ไข/ลบ/merge ข้อมูลลูกค้าโดยทีมงาน</h2>
        <p className="sub">แสดงล่าสุด 200 รายการ — ใครทำอะไร ที่เวลาใด</p>
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
                  <th>เป้าหมาย</th>
                  <th>รายละเอียด</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{formatDateTime(entry.createdAt)}</td>
                    <td>{entry.username}</td>
                    <td>
                      <span className="badge">{ACTION_LABEL[entry.action] ?? entry.action}</span>
                    </td>
                    <td>
                      {existing.has(entry.targetId) ? (
                        <Link href={`/dashboard/leads/${entry.targetId}`}>{entry.targetId}</Link>
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>{entry.targetId} (ไม่มีอยู่แล้ว)</span>
                      )}
                    </td>
                    <td style={{ whiteSpace: "normal", maxWidth: 420 }}>{entry.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
