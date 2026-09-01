import { prisma } from "./db";
import { pushMessage } from "./line";
import type { Lead, Project } from "@prisma/client";

function formatProjectSummary(lead: Lead, project: Project, reason?: string): string {
  const lines = [
    "📋 มีลูกค้าใหม่รอทีมงานติดต่อกลับ (A5 Design LINE OA)",
    `ชื่อ: ${lead.displayName ?? "(ไม่ระบุ)"}`,
    `เบอร์ติดต่อ: ${project.phone ?? "(ไม่ระบุ)"}`,
    `ประเภทงาน: ${project.projectType ?? "(ไม่ระบุ)"}`,
    `รายละเอียดงาน: ${project.projectDetail ?? "(ไม่ระบุ)"}`,
    `งบประมาณ: ${project.budgetRange ?? "(ไม่ระบุ)"}`,
    `พื้นที่/ทำเล: ${project.location ?? "(ไม่ระบุ)"}`,
    `กรอบเวลา: ${project.timeline ?? "(ไม่ระบุ)"}`,
    `ช่วงเวลาที่สะดวกติดต่อกลับ: ${project.contactNote ?? "(ไม่ระบุ)"}`,
  ];
  if (reason) lines.push(`เหตุผลที่ส่งต่อ: ${reason}`);
  lines.push(`ดูรายละเอียด/ประวัติแชทได้ที่ dashboard (Project ID: ${project.id})`);
  return lines.join("\n");
}

// Notifies the staff LINE group/user and logs the notification either way,
// so a failed push is still visible in the dashboard rather than silently lost.
export async function notifyStaff(lead: Lead, project: Project, reason?: string): Promise<void> {
  const staffId = process.env.LINE_STAFF_NOTIFY_ID;
  const message = formatProjectSummary(lead, project, reason);

  if (!staffId) {
    await prisma.staffNotification.create({
      data: { projectId: project.id, channel: "line", status: "failed", message, error: "LINE_STAFF_NOTIFY_ID not set" },
    });
    return;
  }

  try {
    await pushMessage(staffId, [{ type: "text", text: message }]);
    await prisma.staffNotification.create({
      data: { projectId: project.id, channel: "line", status: "sent", message },
    });
  } catch (err) {
    await prisma.staffNotification.create({
      data: {
        projectId: project.id,
        channel: "line",
        status: "failed",
        message,
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }
}
