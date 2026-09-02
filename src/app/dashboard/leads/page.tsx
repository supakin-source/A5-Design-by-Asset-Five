import Link from "next/link";
import { prisma } from "@/lib/db";
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_TONE, formatDateTime } from "@/lib/format";
import { StatusActions } from "../status-actions";

export const dynamic = "force-dynamic";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const query = q?.trim();

  const projects = await prisma.project.findMany({
    where: query
      ? {
          OR: [
            { lead: { displayName: { contains: query, mode: "insensitive" } } },
            { phone: { contains: query, mode: "insensitive" } },
            { projectType: { contains: query, mode: "insensitive" } },
            { projectDetail: { contains: query, mode: "insensitive" } },
            { location: { contains: query, mode: "insensitive" } },
          ],
        }
      : undefined,
    include: { lead: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <>
      <h1 style={{ marginTop: 0 }}>รายการงาน</h1>

      <form action="/dashboard/leads" className="search-bar">
        <input name="q" defaultValue={query ?? ""} placeholder="ค้นหาชื่อ เบอร์ ประเภทงาน หรือทำเล" />
        <button className="link-button" type="submit">
          ค้นหา
        </button>
        {query && (
          <Link href="/dashboard/leads" className="link-button" style={{ display: "flex", alignItems: "center" }}>
            ล้าง
          </Link>
        )}
      </form>

      <div className="card">
        {projects.length === 0 ? (
          <p className="empty">{query ? `ไม่พบงานที่ตรงกับ "${query}"` : "ยังไม่มีงานเข้ามา"}</p>
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
