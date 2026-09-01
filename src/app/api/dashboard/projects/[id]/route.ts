import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, isValidSessionToken, getSessionUsername } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

// Editing/deleting a customer record is destructive and, unlike the read-only
// dashboard pages, isn't covered by the /dashboard/:path* proxy matcher (this
// lives under /api), so the session cookie is checked again here — and a
// second, separate password is required on top of it, per the business's
// request, so a logged-in dashboard session alone isn't enough to change data.
// Returns the acting username on success, so the caller can attribute the
// audit-log entry to it.
async function requireAuthorized(body: { adminPassword?: string }): Promise<{ username: string } | { error: string }> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await isValidSessionToken(token))) return { error: "ต้องเข้าสู่ระบบก่อน" };

  const expected = process.env.DASHBOARD_ADMIN_PASSWORD?.trim();
  if (!expected) return { error: "ยังไม่ได้ตั้งค่า DASHBOARD_ADMIN_PASSWORD ใน environment variables" };
  if (body.adminPassword !== expected) return { error: "รหัสผ่านสำหรับแก้ไขข้อมูลไม่ถูกต้อง" };

  const username = await getSessionUsername(token);
  return username ? { username } : { error: "ไม่พบตัวตนผู้ใช้ในเซสชัน กรุณาเข้าสู่ระบบใหม่" };
}

const EDITABLE_FIELDS = [
  "phone",
  "projectType",
  "projectDetail",
  "budgetRange",
  "location",
  "timeline",
  "contactNote",
  "status",
] as const;

const FIELD_LABEL: Record<(typeof EDITABLE_FIELDS)[number] | "displayName", string> = {
  displayName: "ชื่อลูกค้า",
  phone: "เบอร์ติดต่อ",
  projectType: "ประเภทงาน",
  projectDetail: "รายละเอียดงาน",
  budgetRange: "งบประมาณ",
  location: "พื้นที่/ทำเล",
  timeline: "กรอบเวลา",
  contactNote: "ช่วงเวลาที่สะดวกติดต่อ",
  status: "สถานะ",
};

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as { adminPassword?: string; displayName?: string; [key: string]: unknown };

  const auth = await requireAuthorized(body);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: 401 });

  const project = await prisma.project.findUnique({ where: { id }, include: { lead: true } });
  if (!project) return NextResponse.json({ error: "ไม่พบข้อมูล" }, { status: 404 });

  const data: Record<string, string> = {};
  for (const field of EDITABLE_FIELDS) {
    const value = body[field];
    if (typeof value === "string") data[field] = value.trim();
  }

  // Diff before writing, so the audit trail says what actually changed
  // rather than just "someone saved the form".
  const changes: string[] = [];
  if (typeof body.displayName === "string" && body.displayName.trim() !== (project.lead.displayName ?? "")) {
    changes.push(`${FIELD_LABEL.displayName}: "${project.lead.displayName ?? ""}" -> "${body.displayName.trim()}"`);
  }
  for (const [field, value] of Object.entries(data)) {
    const before = (project as unknown as Record<string, string | null>)[field] ?? "";
    if (value !== before) changes.push(`${FIELD_LABEL[field as keyof typeof FIELD_LABEL]}: "${before}" -> "${value}"`);
  }

  const [, updated] = await prisma.$transaction([
    typeof body.displayName === "string"
      ? prisma.lead.update({ where: { id: project.leadId }, data: { displayName: body.displayName.trim() } })
      : prisma.lead.findUniqueOrThrow({ where: { id: project.leadId } }),
    prisma.project.update({ where: { id }, data }),
  ]);

  await logAudit({
    username: auth.username,
    action: "update",
    targetType: "Project",
    targetId: id,
    detail: changes.length > 0 ? changes.join(", ") : "(ไม่มีการเปลี่ยนแปลงค่า)",
  });

  return NextResponse.json({ ok: true, project: updated });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { adminPassword?: string };

  const auth = await requireAuthorized(body);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: 401 });

  const project = await prisma.project.findUnique({ where: { id }, include: { lead: true } });
  if (!project) return NextResponse.json({ error: "ไม่พบข้อมูล" }, { status: 404 });

  const conversations = await prisma.conversation.findMany({ where: { projectId: id }, select: { id: true } });
  await prisma.$transaction([
    prisma.message.deleteMany({ where: { conversationId: { in: conversations.map((c) => c.id) } } }),
    prisma.conversation.deleteMany({ where: { projectId: id } }),
    prisma.staffNotification.deleteMany({ where: { projectId: id } }),
    prisma.project.delete({ where: { id } }),
  ]);

  await logAudit({
    username: auth.username,
    action: "delete",
    targetType: "Project",
    targetId: id,
    detail: `ลบงานของลูกค้า "${project.lead.displayName ?? "(ไม่ระบุชื่อ)"}" — ประเภทงาน: ${project.projectType ?? "(ไม่ระบุ)"}, เบอร์: ${project.phone ?? "(ไม่ระบุ)"}, สถานะก่อนลบ: ${project.status}`,
  });

  return NextResponse.json({ ok: true });
}
