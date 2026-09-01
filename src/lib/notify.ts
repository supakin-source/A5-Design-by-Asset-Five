import { prisma } from "./db";
import { pushMessage } from "./line";
import type { Lead } from "@prisma/client";

function formatLeadSummary(lead: Lead, reason?: string): string {
  const lines = [
    "📋 มีลูกค้าใหม่รอทีมงานติดต่อกลับ (A5 Design LINE OA)",
    `ชื่อ: ${lead.displayName ?? "(ไม่ระบุ)"}`,
    `เบอร์ติดต่อ: ${lead.phone ?? "(ไม่ระบุ)"}`,
    `ประเภทงาน: ${lead.projectType ?? "(ไม่ระบุ)"}`,
    `รายละเอียดงาน: ${lead.projectDetail ?? "(ไม่ระบุ)"}`,
    `งบประมาณ: ${lead.budgetRange ?? "(ไม่ระบุ)"}`,
    `พื้นที่/ทำเล: ${lead.location ?? "(ไม่ระบุ)"}`,
    `กรอบเวลา: ${lead.timeline ?? "(ไม่ระบุ)"}`,
    `ช่วงเวลาที่สะดวกติดต่อกลับ: ${lead.contactNote ?? "(ไม่ระบุ)"}`,
  ];
  if (reason) lines.push(`เหตุผลที่ส่งต่อ: ${reason}`);
  lines.push(`ดูรายละเอียด/ประวัติแชทได้ที่ dashboard (Lead ID: ${lead.id})`);
  return lines.join("\n");
}

// Notifies the staff LINE group/user and logs the notification either way,
// so a failed push is still visible in the dashboard rather than silently lost.
export async function notifyStaff(lead: Lead, reason?: string): Promise<void> {
  const staffId = process.env.LINE_STAFF_NOTIFY_ID;
  const message = formatLeadSummary(lead, reason);

  if (!staffId) {
    await prisma.staffNotification.create({
      data: { leadId: lead.id, channel: "line", status: "failed", message, error: "LINE_STAFF_NOTIFY_ID not set" },
    });
    return;
  }

  try {
    await pushMessage(staffId, [{ type: "text", text: message }]);
    await prisma.staffNotification.create({
      data: { leadId: lead.id, channel: "line", status: "sent", message },
    });
  } catch (err) {
    await prisma.staffNotification.create({
      data: {
        leadId: lead.id,
        channel: "line",
        status: "failed",
        message,
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }
}
