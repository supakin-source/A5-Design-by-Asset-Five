import { MessageRole, ProjectStatus, type PendingMessage } from "@prisma/client";
import { prisma } from "./db";
import { replyMessage, getLineProfile, getLineImageContent } from "./line";
import { generateChatReply, type ChatTurn } from "./gemini";
import {
  getOrCreateLeadAndConversation,
  applyExtractedFields,
  hasEnoughInfoForHandoff,
  markHandedOff,
  formatKnownFields,
} from "./lead";
import { notifyStaff } from "./notify";
import { isAcknowledgementOnlyBatch } from "./acknowledgement";

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
  const { lead, project, conversation } = await getOrCreateLeadAndConversation(lineUserId, profile?.displayName);

  // "ขอบคุณครับ", "โอเค", a lone 👍 — nothing to answer, and answering would
  // spend a Gemini request from a small daily quota. Recorded, not replied to.
  const hasImage = batch.some((m) => m.kind === "image");
  if (!hasImage && isAcknowledgementOnlyBatch(batch.map((m) => m.text))) {
    console.log("[inbox] acknowledgement only, staying silent", { fragments: batch.length });
    for (const message of batch) {
      if (!message.text.trim()) continue;
      await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: MessageRole.USER,
          content: message.text,
          topic: "รับทราบ/ปิดบทสนทนา",
          createdAt: message.createdAt,
        },
      });
    }
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastActive: new Date() },
    });
    return;
  }

  const recent = await prisma.message.findMany({
    where: { conversationId: conversation.id, role: { in: [MessageRole.USER, MessageRole.BOT] } },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
  });
  // Each bot bubble is its own row, so consecutive rows from the same side are
  // folded back into one turn: fewer, cleaner turns for the same context, and
  // fewer tokens per request.
  const history = recent.reverse().reduce<ChatTurn[]>((turns, message) => {
    const role = message.role === MessageRole.USER ? "user" : "model";
    const previous = turns[turns.length - 1];
    if (previous?.role === role) {
      previous.text += `\n${message.content}`;
    } else {
      turns.push({ role, text: message.content });
    }
    return turns;
  }, []);

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

  const ai = await generateChatReply({
    history,
    userMessage: combinedText,
    images,
    knownFields: formatKnownFields(lead, project),
  });

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

  // One transcript row per bubble, so the dashboard shows exactly what the
  // customer saw.
  for (const bubble of ai.replies) {
    await prisma.message.create({
      data: { conversationId: conversation.id, role: MessageRole.BOT, content: bubble },
    });
  }
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastActive: new Date() },
  });

  const { lead: updatedLead, project: updatedProject } = await applyExtractedFields(
    { leadId: lead.id, projectId: project.id },
    ai.extractedFields,
  );

  // A failed reply must not skip the handoff below: getting the lead to staff
  // matters more than the chat message landing.
  // All bubbles go out in a single reply call: they arrive as separate messages
  // in the chat, and a reply is free where a push message would be metered.
  // The model can also decide this message needed no answer at all.
  if (ai.shouldReply === false || ai.replies.length === 0) {
    console.log("[inbox] model chose not to reply");
  } else {
    try {
      await replyMessage(
        batch[batch.length - 1].replyToken,
        ai.replies.map((text) => ({ type: "text" as const, text })),
      );
    } catch (err) {
      console.error("[inbox] reply failed", err);
    }
  }

  const shouldHandoff = ai.needsHuman || hasEnoughInfoForHandoff(updatedProject);
  if (shouldHandoff && updatedProject.status === ProjectStatus.NEW) {
    await markHandedOff(updatedProject.id);
    await notifyStaff(updatedLead, updatedProject, ai.escalationReason ?? undefined);
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: MessageRole.SYSTEM,
        content: `ส่งต่อทีมงานแล้ว${ai.escalationReason ? ` (${ai.escalationReason})` : ""}`,
      },
    });
  }
}
