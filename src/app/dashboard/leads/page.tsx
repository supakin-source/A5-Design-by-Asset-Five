import Link from "next/link";
import { prisma } from "@/lib/db";
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_TONE, formatDateTime } from "@/lib/format";
import { StatusActions } from "../status-actions";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const projects = await prisma.project.findMany({
    include: { lead: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <>
      <h1 style={{ marginTop: 0 }}>รายการงาน</h1>
      <div className="card">
        <p className="sub">
          200 รายการล่าสุด · หนึ่งแถวคือหนึ่งงาน ลูกค้าเดิมที่กลับมาติดต่อใหม่จะขึ้นเป็นแถวใหม่ ไม่ทับงานเดิม
        </p>
        {projects.length === 0 ? (
          <p className="empty">ยังไม่มีงานเข้ามา</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ลูกค้า</th>
                  <th>เบอร์ติดต่อ</th>
                  <th>ประเภทงาน</th>
                  <th>รายละเอียด</th>
                  <th>งบประมาณ</th>
                  <th>สถานะ</th>
                  <th>เข้ามาเมื่อ</th>
                  <th>อัปเดตสถานะ</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.id}>
                    <td>
                      <Link href={`/dashboard/leads/${project.id}`}>
                        {project.lead.displayName ?? "ไม่ระบุชื่อ"}
                      </Link>
                    </td>
                    <td>{project.phone ?? "—"}</td>
                    <td>{project.projectType ?? "—"}</td>
                    <td style={{ whiteSpace: "normal", maxWidth: 240 }}>{project.projectDetail ?? "—"}</td>
                    <td>{project.budgetRange ?? "—"}</td>
                    <td>
                      <span className={`badge ${PROJECT_STATUS_TONE[project.status]}`}>
                        {PROJECT_STATUS_LABEL[project.status]}
                      </span>
                    </td>
                    <td>{formatDateTime(project.createdAt)}</td>
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
