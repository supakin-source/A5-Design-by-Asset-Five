import { MessageRole, LeadStatus, type PendingMessage } from "@prisma/client";
import { prisma } from "./db";
import { replyMessage, getLineProfile, getLineImageContent } from "./line";
import { generateChatReply, type ChatTurn } from "./gemini";
import {
  getOrCreateLeadAndConversation,
  applyExtractedFields,
  hasEnoughInfoForHandoff,
  markHandedOff,
} from "./lead";
import { notifyStaff } from "./notify";

const HISTORY_LIMIT = 12;

// How long to wait for the customer to finish typing before answering. People
// type a thought across several short messages with real pauses between them,
// so this is deliberately closer to a human's "let them finish" beat than to a
// technical minimum. The whole wait plus the AI call has to fit inside the
// platform's function timeout (see maxDuration in the webhook route) and inside
// LINE's reply-token lifetime, so lower it via MESSAGE_DEBOUNCE_MS if replies
// start timing out.
const DEBOUNCE_MS = Number(process.env.MESSAGE_DEBOUNCE_MS ?? 8000);

// Only the first few images of a burst are sent to the model; more than this in
// one turn adds latency and quota cost without adding much context.
const MAX_IMAGES_PER_BATCH = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function enqueueMessage(params: {
  lineUserId: string;
  lineMessageId: string;
  kind: "text" | "image";
  text: string;
  replyToken: string;
}): Promise<void> {
  await prisma.pendingMessage.create({
    data: {
      lineUserId: params.lineUserId,
      lineMessageId: params.lineMessageId,
      kind: params.kind,
      text: params.text,
      replyToken: params.replyToken,
    },
  });
}

// Waits out the debounce window, then answers the whole burst — but only if this
// invocation is the one holding the customer's newest message. Earlier
// invocations bow out so the customer gets a single reply, not one per fragment.
export async function processAfterDebounce(lineUserId: string, lineMessageId: string): Promise<void> {
  await sleep(DEBOUNCE_MS);

  const pending = await prisma.pendingMessage.findMany({
    where: { lineUserId, processedAt: null },
    orderBy: { createdAt: "asc" },
  });
  if (pending.length === 0) return;

  const newest = pending[pending.length - 1];
  if (newest.lineMessageId !== lineMessageId) {
    // A newer message arrived while we waited; its own invocation owns the batch.
    return;
  }

  // Claim the batch before doing any slow work, so a retried webhook delivery
  // can't produce a second reply to the same messages.
  const claimed = await prisma.pendingMessage.updateMany({
    where: { id: { in: pending.map((m) => m.id) }, processedAt: null },
    data: { processedAt: new Date() },
  });
  if (claimed.count === 0) return;

  await answerBatch(lineUserId, pending);
}

async function answerBatch(lineUserId: string, batch: PendingMessage[]): Promise<void> {
  const profile = await getLineProfile(lineUserId);
  const { lead, conversation } = await getOrCreateLeadAndConversation(lineUserId, profile?.displayName);

  const recent = await prisma.message.findMany({
    where: { conversationId: conversation.id, role: { in: [MessageRole.USER, MessageRole.BOT] } },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
  });
  const history: ChatTurn[] = recent
    .reverse()
    .map((m) => ({ role: m.role === MessageRole.USER ? "user" : "model", text: m.content }));

  const imageMessages = batch.filter((m) => m.kind === "image").slice(0, MAX_IMAGES_PER_BATCH);
  const images = (
    await Promise.all(
      imageMessages.map(async (m) => {
        try {
          return await getLineImageContent(m.lineMessageId);
        } catch (err) {
          console.error("[inbox] could not fetch image content", err);
          return null;
        }
      }),
    )
  ).filter((image): image is { base64: string; mimeType: string } => image !== null);

  // The fragments are joined into one turn so the model reads them as a single
  // thought, the way a person reading the chat would.
  const combinedText = batch
    .filter((m) => m.kind === "text" && m.text.trim().length > 0)
    .map((m) => m.text.trim())
    .join("\n");

  // Counts only, never message content — enough to see batching working in
  // production without putting customer text in the logs.
  console.log("[inbox] answering batch", {
    fragments: batch.length,
    images: images.length,
    mergedLength: combinedText.length,
  });

  const ai = await generateChatReply({ history, userMessage: combinedText, images });

  // Persist each fragment as its own transcript line, tagging the last one with
  // the market-data labels for this turn.
  for (const [index, message] of batch.entries()) {
    const isLast = index === batch.length - 1;
    const content =
      message.kind === "image"
        ? (ai.imageDescription ?? "(ลูกค้าส่งรูปภาพมา)")
        : message.text;
    if (!content.trim()) continue;
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: MessageRole.USER,
        content,
        hasImage: message.kind === "image",
        topic: isLast ? ai.topic : undefined,
        sentiment: isLast ? ai.sentiment : undefined,
        createdAt: message.createdAt,
      },
    });
  }

  await prisma.message.create({
    data: { conversationId: conversation.id, role: MessageRole.BOT, content: ai.reply },
  });
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastActive: new Date() },
  });

  const updatedLead = await applyExtractedFields(lead.id, ai.extractedFields);

  // A failed reply must not skip the handoff below: getting the lead to staff
  // matters more than the chat message landing.
  try {
    await replyMessage(batch[batch.length - 1].replyToken, [{ type: "text", text: ai.reply }]);
  } catch (err) {
    console.error("[inbox] reply failed", err);
  }

  const shouldHandoff = ai.needsHuman || hasEnoughInfoForHandoff(updatedLead);
  if (shouldHandoff && updatedLead.status === LeadStatus.NEW) {
    await markHandedOff(updatedLead.id);
    await notifyStaff(updatedLead, ai.escalationReason ?? undefined);
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: MessageRole.SYSTEM,
        content: `ส่งต่อทีมงานแล้ว${ai.escalationReason ? ` (${ai.escalationReason})` : ""}`,
      },
    });
  }
}
