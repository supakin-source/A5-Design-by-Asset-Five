import Link from "next/link";
import { prisma } from "@/lib/db";
import { LEAD_STATUS_LABEL, formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const leads = await prisma.lead.findMany({ orderBy: { createdAt: "desc" }, take: 200 });

  return (
    <>
      <h1 style={{ fontSize: 20, marginTop: 0 }}>รายชื่อลูกค้า</h1>
      <div className="card">
        <h2>ลูกค้าที่ติดต่อเข้ามาผ่าน LINE OA</h2>
        <p className="sub">แสดงล่าสุด 200 รายการ • คลิกชื่อเพื่อดูบทสนทนาทั้งหมด</p>
        {leads.length === 0 ? (
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
                {leads.map((lead) => (
                  <tr key={lead.id}>
                    <td>
                      <Link href={`/dashboard/leads/${lead.id}`}>{lead.displayName ?? "(ไม่ระบุชื่อ)"}</Link>
                    </td>
                    <td>{lead.phone ?? "—"}</td>
                    <td>{lead.projectType ?? "—"}</td>
                    <td style={{ whiteSpace: "normal", maxWidth: 260 }}>{lead.projectDetail ?? "—"}</td>
                    <td>{lead.budgetRange ?? "—"}</td>
                    <td>{lead.location ?? "—"}</td>
                    <td>{lead.timeline ?? "—"}</td>
                    <td>
                      <span className="badge">{LEAD_STATUS_LABEL[lead.status]}</span>
                    </td>
                    <td>{formatDateTime(lead.createdAt)}</td>
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
