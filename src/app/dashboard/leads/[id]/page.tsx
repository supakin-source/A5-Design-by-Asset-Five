import { notFound } from "next/navigation";
import { MessageRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { LEAD_STATUS_LABEL, formatDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<MessageRole, string> = {
  [MessageRole.USER]: "ลูกค้า",
  [MessageRole.BOT]: "บอท",
  [MessageRole.SYSTEM]: "ระบบ",
};

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      conversations: { include: { messages: { orderBy: { createdAt: "asc" } } }, orderBy: { startedAt: "asc" } },
      staffNotifications: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!lead) notFound();

  const details: Array<[string, string]> = [
    ["ชื่อ", lead.displayName ?? "—"],
    ["เบอร์ติดต่อ", lead.phone ?? "—"],
    ["ประเภทงาน", lead.projectType ?? "—"],
    ["รายละเอียดงาน", lead.projectDetail ?? "—"],
    ["งบประมาณ", lead.budgetRange ?? "—"],
    ["พื้นที่/ทำเล", lead.location ?? "—"],
    ["กรอบเวลา", lead.timeline ?? "—"],
    ["ช่วงเวลาที่สะดวกติดต่อ", lead.contactNote ?? "—"],
    ["สถานะ", LEAD_STATUS_LABEL[lead.status]],
    ["เข้ามาเมื่อ", formatDateTime(lead.createdAt)],
  ];

  const messages = lead.conversations.flatMap((c) => c.messages);

  return (
    <>
      <h1 style={{ fontSize: 20, marginTop: 0 }}>{lead.displayName ?? "(ไม่ระบุชื่อ)"}</h1>

      <div className="grid two">
        <div className="card">
          <h2>ข้อมูลลูกค้า</h2>
          <p className="sub">ข้อมูลที่บอทเก็บได้จากบทสนทนา</p>
          <div className="table-wrap">
            <table>
              <tbody>
                {details.map(([label, value]) => (
                  <tr key={label}>
                    <th style={{ width: 180 }}>{label}</th>
                    <td style={{ whiteSpace: "normal" }}>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h2>การแจ้งเตือนทีมงาน</h2>
          <p className="sub">ประวัติการส่งต่อข้อมูลให้ผู้รับผิดชอบ</p>
          {lead.staffNotifications.length === 0 ? (
            <p className="empty">ยังไม่มีการส่งต่อ</p>
          ) : (
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              {lead.staffNotifications.map((n) => (
                <li key={n.id} style={{ marginBottom: 6 }}>
                  {formatDateTime(n.createdAt)} — {n.status === "sent" ? "ส่งสำเร็จ" : `ส่งไม่สำเร็จ: ${n.error ?? "ไม่ทราบสาเหตุ"}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>บทสนทนา</h2>
        <p className="sub">รูปภาพที่ลูกค้าส่งมาจะแสดงเป็นคำอธิบายข้อความตามนโยบายข้อมูลส่วนบุคคล</p>
        {messages.length === 0 ? (
          <p className="empty">ยังไม่มีบทสนทนา</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`bubble ${m.role === MessageRole.USER ? "user" : "bot"}`}>
              <div className="meta">
                {ROLE_LABEL[m.role]} • {formatDateTime(m.createdAt)}
                {m.hasImage && " • ส่งรูปภาพ"}
                {m.topic && ` • หัวข้อ: ${m.topic}`}
              </div>
              <div style={{ whiteSpace: "pre-wrap" }}>{m.content}</div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
