import { prisma } from "./db";
import type { StructuredChatReply } from "./gemini";
import { ProjectStatus, type Lead, type Project } from "@prisma/client";

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
  const isNewVisit = latest ? SETTLED_STATUSES.includes(latest.status) && gapMs >= NEW_VISIT_GAP_MS : true;

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

export function formatPriorProjectsNote(projects: Project[]): string | undefined {
  if (projects.length === 0) return undefined;
  const lines = projects.map((p, i) => {
    const parts = [p.projectType, p.projectDetail, p.location].filter(Boolean).join(" / ");
    return `- งานก่อนหน้าที่ ${i + 1}: ${parts || "(ไม่มีรายละเอียด)"}`;
  });
  return [
    "ลูกค้ารายนี้มีงานเดิมที่เคยติดต่อไว้แล้ว (ดูรายการด้านล่าง) และตอนนี้ทักมาใหม่ในรอบนี้:",
    ...lines,
    "ก่อนเก็บข้อมูลใหม่ ให้ถามยืนยันสั้น ๆ ก่อนว่าเรื่องที่ติดต่อเข้ามาครั้งนี้เกี่ยวกับงานเดิมข้างต้น",
    "หรือเป็นงานใหม่ ถ้าลูกค้าบอกว่าเป็นเรื่องเดียวกับงานเดิม ให้ส่งต่อทีมงานทันที (needsHuman = true)",
    "ไม่ต้องถามเก็บข้อมูลซ้ำใหม่ทั้งหมด ถ้าเป็นงานใหม่ ให้เก็บข้อมูลตามปกติ",
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

// A project is "ready" for staff follow-up once we have a way to reach the
// customer and know roughly what they want — matches the handoff rule in
// docs/AI_POLICY.md.
export function hasEnoughInfoForHandoff(project: { phone: string | null; projectType: string | null }): boolean {
  return Boolean(project.phone && project.projectType);
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
