import Link from "next/link";
import { LeadStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { LEAD_STATUS_LABEL, formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [total, newThisWeek, handedOff, pendingContact, recentLeads] = await Promise.all([
    prisma.lead.count(),
    prisma.lead.count({ where: { createdAt: { gte: since } } }),
    prisma.lead.count({ where: { status: { in: [LeadStatus.HANDED_OFF, LeadStatus.CONTACTED, LeadStatus.CLOSED] } } }),
    prisma.lead.count({ where: { status: LeadStatus.HANDED_OFF } }),
    prisma.lead.findMany({ orderBy: { updatedAt: "desc" }, take: 10 }),
  ]);

  const handoffRate = total > 0 ? Math.round((handedOff / total) * 100) : 0;

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
        {recentLeads.length === 0 ? (
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
                {recentLeads.map((lead) => (
                  <tr key={lead.id}>
                    <td>
                      <Link href={`/dashboard/leads/${lead.id}`}>{lead.displayName ?? "(ไม่ระบุชื่อ)"}</Link>
                    </td>
                    <td>{lead.projectType ?? "—"}</td>
                    <td>{lead.phone ?? "—"}</td>
                    <td>
                      <span className="badge">{LEAD_STATUS_LABEL[lead.status]}</span>
                    </td>
                    <td>{formatDateTime(lead.updatedAt)}</td>
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
