import { prisma } from "./db";
import type { StructuredChatReply } from "./gemini";
import { LeadStatus } from "@prisma/client";

export async function getOrCreateLeadAndConversation(lineUserId: string, displayName?: string) {
  let lead = await prisma.lead.findUnique({ where: { lineUserId } });
  if (!lead) {
    lead = await prisma.lead.create({
      data: { lineUserId, displayName, consentShownAt: new Date() },
    });
  }

  let conversation = await prisma.conversation.findFirst({
    where: { leadId: lead.id },
    orderBy: { startedAt: "desc" },
  });
  if (!conversation) {
    conversation = await prisma.conversation.create({ data: { leadId: lead.id } });
  }

  return { lead, conversation };
}

export async function applyExtractedFields(leadId: string, fields: StructuredChatReply["extractedFields"]) {
  const data: Record<string, string> = {};
  if (fields.name) data.displayName = fields.name;
  if (fields.phone) data.phone = fields.phone;
  if (fields.projectType) data.projectType = fields.projectType;
  if (fields.projectDetail) data.projectDetail = fields.projectDetail;
  if (fields.budgetRange) data.budgetRange = fields.budgetRange;
  if (fields.location) data.location = fields.location;
  if (fields.timeline) data.timeline = fields.timeline;
  if (fields.contactNote) data.contactNote = fields.contactNote;

  if (Object.keys(data).length === 0) return prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
  return prisma.lead.update({ where: { id: leadId }, data });
}

// A lead is "ready" for staff follow-up once we have a way to reach them and
// know roughly what they want — matches the handoff rule in docs/AI_POLICY.md.
export function hasEnoughInfoForHandoff(lead: { phone: string | null; projectType: string | null }): boolean {
  return Boolean(lead.phone && lead.projectType);
}

export async function markHandedOff(leadId: string) {
  await prisma.lead.update({
    where: { id: leadId },
    data: { status: LeadStatus.HANDED_OFF },
  });
}
