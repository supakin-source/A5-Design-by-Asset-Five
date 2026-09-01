import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, isValidSessionToken } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// Editing/deleting a customer record is destructive and, unlike the read-only
// dashboard pages, isn't covered by the /dashboard/:path* proxy matcher (this
// lives under /api), so the session cookie is checked again here — and a
// second, separate password is required on top of it, per the business's
// request, so a logged-in dashboard session alone isn't enough to change data.
async function requireAuthorized(body: { adminPassword?: string }): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await isValidSessionToken(token))) return "ต้องเข้าสู่ระบบก่อน";

  const expected = process.env.DASHBOARD_ADMIN_PASSWORD?.trim();
  if (!expected) return "ยังไม่ได้ตั้งค่า DASHBOARD_ADMIN_PASSWORD ใน environment variables";
  if (body.adminPassword !== expected) return "รหัสผ่านสำหรับแก้ไขข้อมูลไม่ถูกต้อง";
  return null;
}

const EDITABLE_FIELDS = [
  "phone",
  "projectType",
  "projectDetail",
  "budgetRange",
  "location",
  "timeline",
  "contactNote",
  "notes",
  "status",
] as const;

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as { adminPassword?: string; displayName?: string; [key: string]: unknown };

  const authError = await requireAuthorized(body);
  if (authError) return NextResponse.json({ error: authError }, { status: 401 });

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) return NextResponse.json({ error: "ไม่พบข้อมูล" }, { status: 404 });

  const data: Record<string, string> = {};
  for (const field of EDITABLE_FIELDS) {
    const value = body[field];
    if (typeof value === "string") data[field] = value.trim();
  }

  const [, updated] = await prisma.$transaction([
    typeof body.displayName === "string"
      ? prisma.lead.update({ where: { id: project.leadId }, data: { displayName: body.displayName.trim() } })
      : prisma.lead.findUniqueOrThrow({ where: { id: project.leadId } }),
    prisma.project.update({ where: { id }, data }),
  ]);

  return NextResponse.json({ ok: true, project: updated });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { adminPassword?: string };

  const authError = await requireAuthorized(body);
  if (authError) return NextResponse.json({ error: authError }, { status: 401 });

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) return NextResponse.json({ error: "ไม่พบข้อมูล" }, { status: 404 });

  const conversations = await prisma.conversation.findMany({ where: { projectId: id }, select: { id: true } });
  await prisma.$transaction([
    prisma.message.deleteMany({ where: { conversationId: { in: conversations.map((c) => c.id) } } }),
    prisma.conversation.deleteMany({ where: { projectId: id } }),
    prisma.staffNotification.deleteMany({ where: { projectId: id } }),
    prisma.project.delete({ where: { id } }),
  ]);

  return NextResponse.json({ ok: true });
}
