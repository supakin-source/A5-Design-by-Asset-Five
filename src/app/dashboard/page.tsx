import Link from "next/link";
import { ProjectStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PROJECT_STATUS_LABEL, formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // "ลูกค้า" counts unique customers (Lead); handoff/contact status and the
  // recent-activity table are per service request (Project) — a returning
  // customer's second inquiry is a separate row there, not a repeat of the
  // first.
  const [total, newThisWeek, totalProjects, handedOff, pendingContact, recentProjects] = await Promise.all([
    prisma.lead.count(),
    prisma.lead.count({ where: { createdAt: { gte: since } } }),
    prisma.project.count(),
    prisma.project.count({
      where: { status: { in: [ProjectStatus.HANDED_OFF, ProjectStatus.CONTACTED, ProjectStatus.CLOSED] } },
    }),
    prisma.project.count({ where: { status: ProjectStatus.HANDED_OFF } }),
    prisma.project.findMany({ include: { lead: true }, orderBy: { updatedAt: "desc" }, take: 10 }),
  ]);

  const handoffRate = totalProjects > 0 ? Math.round((handedOff / totalProjects) * 100) : 0;

  return (
    <>
      <h1 style={{ fontSize: 20, marginTop: 0 }}>ภาพรวม</h1>

      <div className="grid kpi" style={{ marginBottom: 24 }}>
        <div className="card">
          <div className="kpi-value">{total}</div>
          <div className="kpi-label">ลูกค้าที่ติดต่อเข้ามาทั้งหมด</div>
        </div>
        <div className="card">
          <div className="kpi-value">{newThisWeek}</div>
          <div className="kpi-label">รายใหม่ใน 7 วันล่าสุด</div>
        </div>
        <div className="card">
          <div className="kpi-value">{pendingContact}</div>
          <div className="kpi-label">รอทีมงานติดต่อกลับ</div>
        </div>
        <div className="card">
          <div className="kpi-value">{handoffRate}%</div>
          <div className="kpi-label">สัดส่วนที่เก็บข้อมูลได้ครบจนส่งต่อทีมงาน</div>
        </div>
      </div>

      <div className="card">
        <h2>ความเคลื่อนไหวล่าสุด</h2>
        <p className="sub">10 รายการที่มีการอัปเดตล่าสุด</p>
        {recentProjects.length === 0 ? (
          <p className="empty">ยังไม่มีข้อมูลลูกค้าเข้ามา</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ลูกค้า</th>
                  <th>ประเภทงาน</th>
                  <th>เบอร์ติดต่อ</th>
                  <th>สถานะ</th>
                  <th>อัปเดต</th>
                </tr>
              </thead>
              <tbody>
                {recentProjects.map((project) => (
                  <tr key={project.id}>
                    <td>
                      <Link href={`/dashboard/leads/${project.id}`}>{project.lead.displayName ?? "(ไม่ระบุชื่อ)"}</Link>
                    </td>
                    <td>{project.projectType ?? "—"}</td>
                    <td>{project.phone ?? "—"}</td>
                    <td>
                      <span className="badge">{PROJECT_STATUS_LABEL[project.status]}</span>
                    </td>
                    <td>{formatDateTime(project.updatedAt)}</td>
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
