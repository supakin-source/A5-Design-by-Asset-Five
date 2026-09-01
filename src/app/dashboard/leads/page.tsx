import Link from "next/link";
import { prisma } from "@/lib/db";
import { PROJECT_STATUS_LABEL, formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const projects = await prisma.project.findMany({
    include: { lead: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <>
      <h1 style={{ fontSize: 20, marginTop: 0 }}>รายชื่อลูกค้า</h1>
      <div className="card">
        <h2>การติดต่อเข้ารับบริการผ่าน LINE OA</h2>
        <p className="sub">
          แสดงล่าสุด 200 รายการ • หนึ่งแถวคือหนึ่งงานที่ลูกค้าติดต่อเข้ามา ลูกค้าคนเดิมที่กลับมาขอรับบริการใหม่
          จะมีอีกแถวแยกไว้ ไม่ทับข้อมูลงานเดิม • คลิกเพื่อดูบทสนทนาทั้งหมด
        </p>
        {projects.length === 0 ? (
          <p className="empty">ยังไม่มีข้อมูลลูกค้าเข้ามา</p>
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
                  <th>พื้นที่</th>
                  <th>กรอบเวลา</th>
                  <th>สถานะ</th>
                  <th>เข้ามาเมื่อ</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.id}>
                    <td>
                      <Link href={`/dashboard/leads/${project.id}`}>
                        {project.lead.displayName ?? "(ไม่ระบุชื่อ)"}
                      </Link>
                    </td>
                    <td>{project.phone ?? "—"}</td>
                    <td>{project.projectType ?? "—"}</td>
                    <td style={{ whiteSpace: "normal", maxWidth: 260 }}>{project.projectDetail ?? "—"}</td>
                    <td>{project.budgetRange ?? "—"}</td>
                    <td>{project.location ?? "—"}</td>
                    <td>{project.timeline ?? "—"}</td>
                    <td>
                      <span className="badge">{PROJECT_STATUS_LABEL[project.status]}</span>
                    </td>
                    <td>{formatDateTime(project.createdAt)}</td>
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
