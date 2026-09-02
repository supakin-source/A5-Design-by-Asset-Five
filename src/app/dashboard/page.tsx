import Link from "next/link";
import { ProjectStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_TONE, formatDateTime } from "@/lib/format";
import { StatusActions } from "./status-actions";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  // "ลูกค้า" counts unique customers (Lead); status counts and the recent
  // activity table are per job (Project) — a returning customer's second
  // inquiry is a separate row there, not a repeat of the first.
  const [customers, contactedBack, totalJobs, handedOff, waitingCallback, recentProjects] = await Promise.all([
    prisma.lead.count(),
    prisma.project.count({ where: { status: ProjectStatus.CONTACTED } }),
    prisma.project.count(),
    prisma.project.count({
      where: { status: { in: [ProjectStatus.HANDED_OFF, ProjectStatus.CONTACTED, ProjectStatus.CLOSED] } },
    }),
    prisma.project.count({ where: { status: ProjectStatus.HANDED_OFF } }),
    prisma.project.findMany({ include: { lead: true }, orderBy: { updatedAt: "desc" }, take: 10 }),
  ]);

  const handoffRate = totalJobs > 0 ? Math.round((handedOff / totalJobs) * 100) : 0;

  return (
    <>
      <h1 style={{ marginTop: 0 }}>ภาพรวม</h1>

      <div className="grid kpi" style={{ marginBottom: 24 }}>
        <div className="card">
          <div className="kpi-value">{waitingCallback}</div>
          <div className="kpi-label">รอติดต่อกลับ</div>
        </div>
        <div className="card">
          <div className="kpi-value">{contactedBack}</div>
          <div className="kpi-label">ติดต่อกลับแล้ว</div>
        </div>
        <div className="card">
          <div className="kpi-value">{customers}</div>
          <div className="kpi-label">ลูกค้าทั้งหมด</div>
        </div>
        <div className="card">
          <div className="kpi-value">{handoffRate}%</div>
          <div className="kpi-label">งานที่เก็บข้อมูลครบจนส่งต่อทีมงานได้</div>
        </div>
      </div>

      <div className="card">
        <h2>ความเคลื่อนไหวล่าสุด</h2>
        {recentProjects.length === 0 ? (
          <p className="empty">ยังไม่มีงานเข้ามา</p>
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
                  <th>อัปเดตสถานะ</th>
                </tr>
              </thead>
              <tbody>
                {recentProjects.map((project) => (
                  <tr key={project.id}>
                    <td>
                      <Link href={`/dashboard/leads/${project.id}`}>{project.lead.displayName ?? "ไม่ระบุชื่อ"}</Link>
                    </td>
                    <td>{project.projectType ?? "—"}</td>
                    <td>{project.phone ?? "—"}</td>
                    <td>
                      <span className={`badge ${PROJECT_STATUS_TONE[project.status]}`}>
                        {PROJECT_STATUS_LABEL[project.status]}
                      </span>
                    </td>
                    <td>{formatDateTime(project.updatedAt)}</td>
                    <td>
                      <StatusActions projectId={project.id} status={project.status} />
                    </td>
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
