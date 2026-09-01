import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ProjectStatus } from "@prisma/client";
import { SESSION_COOKIE, isValidSessionToken, getSessionUsername } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { PROJECT_STATUS_LABEL } from "@/lib/format";

export const runtime = "nodejs";

// Moving a job along its workflow ("ติดต่อแล้ว", "ปิดงาน") is routine, reversible
// work staff do many times a day, so unlike editing or deleting a record it
// asks for the login session only — no second password. Requiring one here
// would just teach the team to keep the admin password on a sticky note.
// Every change is still attributed in the audit log.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { status?: string };

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await isValidSessionToken(token))) {
    return NextResponse.json({ error: "ต้องเข้าสู่ระบบก่อน" }, { status: 401 });
  }
  const username = await getSessionUsername(token);
  if (!username) return NextResponse.json({ error: "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่" }, { status: 401 });

  const status = body.status as ProjectStatus | undefined;
  if (!status || !Object.values(ProjectStatus).includes(status)) {
    return NextResponse.json({ error: "สถานะไม่ถูกต้อง" }, { status: 400 });
  }

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) return NextResponse.json({ error: "ไม่พบข้อมูล" }, { status: 404 });
  if (project.status === status) return NextResponse.json({ ok: true });

  await prisma.project.update({ where: { id }, data: { status } });
  await logAudit({
    username,
    action: "status",
    targetType: "Project",
    targetId: id,
    detail: `สถานะ: "${PROJECT_STATUS_LABEL[project.status]}" -> "${PROJECT_STATUS_LABEL[status]}"`,
  });

  return NextResponse.json({ ok: true });
}
