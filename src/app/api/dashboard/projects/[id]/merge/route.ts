import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, isValidSessionToken } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const FIELD_KEYS = [
  "phone",
  "projectType",
  "projectDetail",
  "budgetRange",
  "location",
  "timeline",
  "contactNote",
  "notes",
] as const;

// Folds a duplicate Project (e.g. one created by the mid-conversation
// fragmentation bug — see docs/AI_POLICY.md §1.2a) into the one being kept:
// same merge as scripts/merge-duplicate-projects.ts, exposed here so staff
// can do it from the dashboard instead of a terminal.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: primaryId } = await params;
  const body = (await req.json()) as { duplicateProjectId?: string; adminPassword?: string };

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await isValidSessionToken(token))) {
    return NextResponse.json({ error: "ต้องเข้าสู่ระบบก่อน" }, { status: 401 });
  }
  const expected = process.env.DASHBOARD_ADMIN_PASSWORD?.trim();
  if (!expected) {
    return NextResponse.json({ error: "ยังไม่ได้ตั้งค่า DASHBOARD_ADMIN_PASSWORD ใน environment variables" }, { status: 500 });
  }
  if (body.adminPassword !== expected) {
    return NextResponse.json({ error: "รหัสผ่านสำหรับแก้ไขข้อมูลไม่ถูกต้อง" }, { status: 401 });
  }

  const duplicateId = body.duplicateProjectId;
  if (!duplicateId) return NextResponse.json({ error: "ไม่ได้ระบุงานที่จะ merge" }, { status: 400 });

  const [primary, duplicate] = await Promise.all([
    prisma.project.findUnique({ where: { id: primaryId } }),
    prisma.project.findUnique({ where: { id: duplicateId } }),
  ]);
  if (!primary || !duplicate) return NextResponse.json({ error: "ไม่พบข้อมูล" }, { status: 404 });
  if (primary.leadId !== duplicate.leadId) {
    return NextResponse.json({ error: "งานทั้งสองเป็นของลูกค้าคนละคน — ปฏิเสธการ merge" }, { status: 400 });
  }

  const fill: Record<string, string> = {};
  for (const key of FIELD_KEYS) {
    if (!primary[key] && duplicate[key]) fill[key] = duplicate[key] as string;
  }

  await prisma.$transaction([
    ...(Object.keys(fill).length > 0 ? [prisma.project.update({ where: { id: primaryId }, data: fill })] : []),
    prisma.conversation.updateMany({ where: { projectId: duplicateId }, data: { projectId: primaryId } }),
    prisma.staffNotification.updateMany({ where: { projectId: duplicateId }, data: { projectId: primaryId } }),
    prisma.project.delete({ where: { id: duplicateId } }),
  ]);

  return NextResponse.json({ ok: true });
}
