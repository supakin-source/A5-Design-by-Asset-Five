import { notFound } from "next/navigation";
import Link from "next/link";
import { MessageRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PROJECT_STATUS_LABEL, formatDateTime } from "@/lib/format";
import { EditProject } from "./edit-project";
import { MergeButton } from "./merge-button";

export const dynamic = "force-dynamic";

const ROLE_LABEL: Record<MessageRole, string> = {
  [MessageRole.USER]: "ลูกค้า",
  [MessageRole.BOT]: "บอท",
  [MessageRole.SYSTEM]: "ระบบ",
};

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      lead: true,
      conversations: { include: { messages: { orderBy: { createdAt: "asc" } } }, orderBy: { startedAt: "asc" } },
      staffNotifications: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!project) notFound();

  // Other service requests from the same customer — the point of splitting
  // Lead (identity) from Project (one inquiry) is exactly so staff can see
  // this history instead of it being silently overwritten.
  const otherProjects = await prisma.project.findMany({
    where: { leadId: project.leadId, id: { not: project.id } },
    orderBy: { createdAt: "desc" },
  });

  const messages = project.conversations.flatMap((c) => c.messages);

  return (
    <>
      <h1 style={{ fontSize: 20, marginTop: 0 }}>{project.lead.displayName ?? "(ไม่ระบุชื่อ)"}</h1>

      <div className="grid two">
        <EditProject
          project={{
            id: project.id,
            displayName: project.lead.displayName ?? "",
            phone: project.phone ?? "",
            projectType: project.projectType ?? "",
            projectDetail: project.projectDetail ?? "",
            budgetRange: project.budgetRange ?? "",
            location: project.location ?? "",
            timeline: project.timeline ?? "",
            contactNote: project.contactNote ?? "",
            status: project.status,
            createdAt: project.createdAt,
          }}
        />

        <div className="card">
          <h2>การแจ้งเตือนทีมงาน</h2>
          <p className="sub">ประวัติการส่งต่อข้อมูลให้ผู้รับผิดชอบ</p>
          {project.staffNotifications.length === 0 ? (
            <p className="empty">ยังไม่มีการส่งต่อ</p>
          ) : (
            <ul style={{ paddingLeft: 18, margin: 0 }}>
              {project.staffNotifications.map((n) => (
                <li key={n.id} style={{ marginBottom: 6 }}>
                  {formatDateTime(n.createdAt)} — {n.status === "sent" ? "ส่งสำเร็จ" : `ส่งไม่สำเร็จ: ${n.error ?? "ไม่ทราบสาเหตุ"}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {otherProjects.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>ประวัติการติดต่อเข้ารับบริการอื่น ๆ ของลูกค้ารายนี้</h2>
          <p className="sub">ลูกค้าคนเดิมกลับมาขอรับบริการใหม่ — งานอื่นของลูกค้ารายนี้ ({otherProjects.length} งาน)</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ประเภทงาน</th>
                  <th>รายละเอียด</th>
                  <th>สถานะ</th>
                  <th>เข้ามาเมื่อ</th>
                  <th>ถ้าเป็นงานเดียวกัน (ข้อมูลซ้ำ)</th>
                </tr>
              </thead>
              <tbody>
                {otherProjects.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/dashboard/leads/${p.id}`}>{p.projectType ?? "(ไม่ระบุประเภทงาน)"}</Link>
                    </td>
                    <td style={{ whiteSpace: "normal", maxWidth: 260 }}>{p.projectDetail ?? "—"}</td>
                    <td>
                      <span className="badge">{PROJECT_STATUS_LABEL[p.status]}</span>
                    </td>
                    <td>{formatDateTime(p.createdAt)}</td>
                    <td>
                      <MergeButton primaryProjectId={project.id} duplicateProjectId={p.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
