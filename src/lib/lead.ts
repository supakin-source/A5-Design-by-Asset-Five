import { prisma } from "./db";
import type { StructuredChatReply } from "./gemini";
import { ProjectStatus, type Lead, type Project } from "@prisma/client";
import { formatDate } from "./format";

// A project counts as settled once it has left staff's inbox.
const SETTLED_STATUSES: ProjectStatus[] = [ProjectStatus.HANDED_OFF, ProjectStatus.CONTACTED, ProjectStatus.CLOSED];

// A settled project only counts as "the customer is done, and is asking about
// something new" once real time has passed since the conversation was last
// active. Without this gap, a customer who simply keeps chatting after the
// handoff threshold happens to trip (phone + project type collected) gets
// fragmented into a brand-new Project on their very next message, even
// though it's the same job — this is exactly the duplicate-data bug found
// live (one "ต่อเติม" customer ended up with three Project rows within
// minutes). An hour comfortably exceeds a normal chat's think-time gaps
// while staying far short of "the customer came back another day".
const NEW_VISIT_GAP_MS = 60 * 60 * 1000;

// CLOSED is the exception: staff have marked the job finished, so anything
// the customer says next is new business by definition and opens a fresh
// project straight away, with no waiting period. HANDED_OFF and CONTACTED
// still wait out the gap — that job may well be ongoing, and a follow-up
// message about it belongs to the same project.
export function startsNewProject(status: ProjectStatus, gapMs: number): boolean {
  if (status === ProjectStatus.CLOSED) return true;
  return SETTLED_STATUSES.includes(status) && gapMs >= NEW_VISIT_GAP_MS;
}

export async function getOrCreateLeadAndConversation(lineUserId: string, displayName?: string) {
  let lead = await prisma.lead.findUnique({ where: { lineUserId } });
  if (!lead) {
    lead = await prisma.lead.create({ data: { lineUserId, displayName, consentShownAt: new Date() } });
  }

  const latest = await prisma.project.findFirst({
    where: { leadId: lead.id },
    orderBy: { createdAt: "desc" },
    include: { conversations: { orderBy: { lastActive: "desc" }, take: 1 } },
  });
  const lastActive = latest?.conversations[0]?.lastActive;
  const gapMs = lastActive ? Date.now() - lastActive.getTime() : Infinity;
  const isNewVisit = latest ? startsNewProject(latest.status, gapMs) : true;

  let project: Project;
  if (isNewVisit) {
    // Carry the phone number forward: it's very likely still valid, and
    // asking a returning customer to repeat it is exactly what customers
    // have flagged as broken (see docs/AI_POLICY.md §1.2a).
    project = await prisma.project.create({ data: { leadId: lead.id, phone: latest?.phone ?? undefined } });
  } else {
    project = latest!;
  }

  let conversation = await prisma.conversation.findFirst({
    where: { projectId: project.id },
    orderBy: { startedAt: "desc" },
  });
  if (!conversation) {
    conversation = await prisma.conversation.create({ data: { projectId: project.id } });
  }

  return { lead, project, conversation, isNewVisit };
}

// Other settled projects this lead already has on file, most recent first —
// used to prompt the "is this about your existing job, or something new?"
// clarifying question on a genuinely new visit. Excludes the project just
// created for the current visit.
export async function getPriorSettledProjects(leadId: string, excludeProjectId: string): Promise<Project[]> {
  return prisma.project.findMany({
    where: { leadId, id: { not: excludeProjectId }, status: { in: SETTLED_STATUSES } },
    orderBy: { createdAt: "desc" },
  });
}

// "ทีมงานยังไม่ได้ติดต่อกลับ" / "ทีมงานติดต่อไปแล้ว (วันที่)" — the phrasing the
// model is told to answer with directly when a customer complains about a
// callback, instead of asking the generic "is this old or new" question
// while blind to whether staff actually pressed "ติดต่อแล้ว" yet.
function formatCallbackStatus(project: Project): string {
  if (project.status === ProjectStatus.HANDED_OFF) return "ทีมงานยังไม่ได้ติดต่อกลับ";
  if (project.status === ProjectStatus.CONTACTED) return `ทีมงานติดต่อไปแล้ว (${formatDate(project.updatedAt)})`;
  return "ปิดงานแล้ว";
}

export function formatPriorProjectsNote(projects: Project[]): string | undefined {
  if (projects.length === 0) return undefined;
  const lines = projects.map((p, i) => {
    const parts = [p.projectType, p.projectDetail, p.location].filter(Boolean).join(" / ");
    return `- งานก่อนหน้าที่ ${i + 1}: ${parts || "(ไม่มีรายละเอียด)"} — สถานะ: ${formatCallbackStatus(p)}`;
  });
  return [
    "ลูกค้ารายนี้มีงานเดิมที่เคยติดต่อไว้แล้ว (ดูรายการด้านล่าง) และตอนนี้ทักมาใหม่ในรอบนี้:",
    ...lines,
    "",
    "ถ้าข้อความล่าสุดของลูกค้าเป็นการถามหรือร้องเรียนเรื่องการติดต่อกลับ (เช่น \"ไหน",
    "พนักงานติดต่อกลับ\" \"ทำไมยังไม่มีคนติดต่อมา\") ให้ตอบตามสถานะจริงของงานนั้น",
    "ข้างต้นทันที ไม่ต้องถามยืนยันเรื่องเดิม/เรื่องใหม่ก่อน:",
    "- สถานะ \"ทีมงานยังไม่ได้ติดต่อกลับ\": ขอโทษที่ทำให้รอ แจ้งว่าจะเร่งประสานให้",
    "  ทีมงานติดต่อกลับโดยเร็วที่สุด แล้วส่งต่อทีมงานทันที (needsHuman = true)",
    "- สถานะ \"ทีมงานติดต่อไปแล้ว (วันที่)\": แจ้งวันที่ทีมงานติดต่อไปแล้วตามข้อมูล",
    "  ข้างต้น ถ้าลูกค้าบอกว่ายังไม่ได้รับการติดต่อจริง ให้ขอโทษและส่งต่อทีมงานอีกครั้ง",
    "  (needsHuman = true)",
    "",
    "ถ้าข้อความล่าสุดไม่ได้ถามเรื่องการติดต่อกลับ ให้ถามยืนยันสั้น ๆ ก่อนว่าเรื่องที่",
    "ติดต่อเข้ามาครั้งนี้เกี่ยวกับงานเดิมข้างต้นหรือเป็นงานใหม่ ถ้าลูกค้าบอกว่าเป็นเรื่อง",
    "เดียวกับงานเดิม ให้ส่งต่อทีมงานทันที (needsHuman = true) ไม่ต้องถามเก็บข้อมูลซ้ำใหม่",
    "ทั้งหมด ถ้าเป็นงานใหม่ ให้เก็บข้อมูลตามปกติ",
  ].join("\n");
}

export async function applyExtractedFields(
  ids: { leadId: string; projectId: string },
  fields: StructuredChatReply["extractedFields"],
): Promise<{ lead: Lead; project: Project }> {
  // The customer's name is an identity attribute of the person, not of any
  // one service request, so it lives on Lead rather than on the project.
  const lead = fields.name
    ? await prisma.lead.update({ where: { id: ids.leadId }, data: { displayName: fields.name } })
    : await prisma.lead.findUniqueOrThrow({ where: { id: ids.leadId } });

  const data: Record<string, string> = {};
  if (fields.phone) data.phone = fields.phone;
  if (fields.projectType) data.projectType = fields.projectType;
  if (fields.projectDetail) data.projectDetail = fields.projectDetail;
  if (fields.budgetRange) data.budgetRange = fields.budgetRange;
  if (fields.location) data.location = fields.location;
  if (fields.timeline) data.timeline = fields.timeline;
  if (fields.contactNote) data.contactNote = fields.contactNote;

  const project =
    Object.keys(data).length === 0
      ? await prisma.project.findUniqueOrThrow({ where: { id: ids.projectId } })
      : await prisma.project.update({ where: { id: ids.projectId }, data });

  return { lead, project };
}

// A project is "ready" for staff follow-up once the job is actually
// summarizable — a way to reach the customer, what they want, and at least
// one substantive detail about the job — not just contact + project type
// with nothing else. Notifying staff the moment those first two fields land
// means the group message is mostly "(ไม่ระบุ)" for everything else, which
// happened for real (see docs/AI_POLICY.md). Requiring ALL of budget,
// location AND a description was tried and over-corrected: a real customer
// who gave a full project description and a budget, but never named an
// area (e.g. redecorating a specific condo unit — there's no "location" to
// give beyond the unit itself), got stuck with no notification at all even
// though staff had plenty to act on. So this only requires *one* of those
// three — enough for the message to read as a real job, not a guarantee
// every field is filled. This is a backup gate: the model itself is also
// told (buildSystemPrompt, item 8) not to set needsHuman=true this early,
// but a genuine "ลูกค้าขอคุยกับคนจริง" / complaint / out-of-scope question
// still hands off immediately regardless of this check — see the
// `ai.needsHuman || hasEnoughInfoForHandoff(...)` call in src/lib/inbox.ts.
export function hasEnoughInfoForHandoff(project: {
  phone: string | null;
  projectType: string | null;
  projectDetail: string | null;
  budgetRange: string | null;
  location: string | null;
}): boolean {
  return Boolean(
    project.phone && project.projectType && (project.projectDetail || project.budgetRange || project.location),
  );
}

export async function markHandedOff(projectId: string) {
  await prisma.project.update({
    where: { id: projectId },
    data: { status: ProjectStatus.HANDED_OFF },
  });
}

// What this project already has on file, formatted for the system prompt —
// see the "knownFields" param on generateChatReply in src/lib/gemini.ts.
// Without this, the model only sees the last few chat messages and has no way
// to know a fact was already given once it scrolls out of that window; it
// will re-ask, or worse, claim it was never recorded at all.
export function formatKnownFields(lead: Lead, project: Project): string | undefined {
  const lines: string[] = [];
  if (lead.displayName) lines.push(`- ชื่อลูกค้า: ${lead.displayName}`);
  if (project.phone) lines.push(`- เบอร์ติดต่อ: ${project.phone}`);
  if (project.projectType) lines.push(`- ประเภทงาน: ${project.projectType}`);
  if (project.projectDetail) lines.push(`- รายละเอียดงาน: ${project.projectDetail}`);
  if (project.budgetRange) lines.push(`- งบประมาณ: ${project.budgetRange}`);
  if (project.location) lines.push(`- พื้นที่/ทำเล: ${project.location}`);
  if (project.timeline) lines.push(`- กรอบเวลา: ${project.timeline}`);
  if (project.contactNote) lines.push(`- ช่วงเวลาที่สะดวกติดต่อ: ${project.contactNote}`);
  return lines.length > 0 ? lines.join("\n") : undefined;
}
