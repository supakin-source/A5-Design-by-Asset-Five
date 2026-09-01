import { prisma } from "./db";
import type { StructuredChatReply } from "./gemini";
import { ProjectStatus, type Lead, type Project } from "@prisma/client";

// A project counts as settled once it has left staff's inbox — a returning
// customer at that point is asking about something new, not continuing an
// old conversation, so they get a fresh Project instead of overwriting the
// settled one's details.
const SETTLED_STATUSES: ProjectStatus[] = [ProjectStatus.HANDED_OFF, ProjectStatus.CONTACTED, ProjectStatus.CLOSED];

export async function getOrCreateLeadAndConversation(lineUserId: string, displayName?: string) {
  let lead = await prisma.lead.findUnique({ where: { lineUserId } });
  if (!lead) {
    lead = await prisma.lead.create({ data: { lineUserId, displayName, consentShownAt: new Date() } });
  }

  let project = await prisma.project.findFirst({ where: { leadId: lead.id }, orderBy: { createdAt: "desc" } });
  if (!project || SETTLED_STATUSES.includes(project.status)) {
    // Carry the phone number forward: it's very likely still valid, and
    // asking a returning customer to repeat it is exactly what customers
    // have flagged as broken (see docs/AI_POLICY.md §1.2).
    project = await prisma.project.create({ data: { leadId: lead.id, phone: project?.phone ?? undefined } });
  }

  let conversation = await prisma.conversation.findFirst({
    where: { projectId: project.id },
    orderBy: { startedAt: "desc" },
  });
  if (!conversation) {
    conversation = await prisma.conversation.create({ data: { projectId: project.id } });
  }

  return { lead, project, conversation };
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
