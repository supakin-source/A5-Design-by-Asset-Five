import { NextResponse } from "next/server";
import { MessageRole, LeadStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { verifyLineSignature, replyMessage, getLineProfile, getLineImageContent } from "@/lib/line";
import { generateChatReply, type ChatTurn } from "@/lib/gemini";
import {
  getOrCreateLeadAndConversation,
  applyExtractedFields,
  hasEnoughInfoForHandoff,
  markHandedOff,
} from "@/lib/lead";
import { notifyStaff } from "@/lib/notify";

export const runtime = "nodejs";

const HISTORY_LIMIT = 12;

const GREETING = [
  "สวัสดีค่ะ 🙏 ที่นี่ A5 Design by Asset Five (ออกแบบและก่อสร้างครบวงจร turn-key)",
  "ดิฉันเป็นผู้ช่วย AI ที่คอยรับเรื่องเบื้องต้นตลอด 24 ชม. ก่อนส่งต่อให้ทีมงานติดต่อกลับค่ะ",
  "",
  "ข้อมูลที่ท่านแจ้ง (เช่น ชื่อ เบอร์ติดต่อ รายละเอียดงาน) จะถูกเก็บเพื่อให้ทีมงานติดต่อกลับ และอาจใช้ข้อมูลบทสนทนาแบบไม่ระบุตัวบุคคลเพื่อพัฒนาบริการ หากไม่ประสงค์ให้เก็บข้อมูล แจ้งได้ทุกเมื่อค่ะ",
  "",
  "รบกวนเล่าคร่าว ๆ ได้เลยค่ะว่าสนใจงานลักษณะใด (เช่น สร้างบ้านใหม่ รีโนเวท หรือออกแบบ)",
].join("\n");

interface LineEvent {
  type: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: { type: string; id: string; text?: string };
}

export async function POST(req: Request) {
  const rawBody = await req.text();

  if (!verifyLineSignature(rawBody, req.headers.get("x-line-signature"))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const body = JSON.parse(rawBody) as { events?: LineEvent[] };
  const events = body.events ?? [];

  for (const event of events) {
    try {
      await handleEvent(event);
    } catch (err) {
      // Always answer LINE with 200 so it doesn't retry-storm; the failure is
      // logged for the team instead.
      console.error("[line-webhook] event failed", err);
    }
  }

  return NextResponse.json({ ok: true });
}

async function handleEvent(event: LineEvent) {
  const userId = event.source?.userId;
  if (!userId) return;

  if (event.type === "follow") {
    const profile = await getLineProfile(userId);
    await getOrCreateLeadAndConversation(userId, profile?.displayName);
    if (event.replyToken) {
      await replyMessage(event.replyToken, [{ type: "text", text: GREETING }]);
    }
    return;
  }

  if (event.type !== "message" || !event.message) return;

  const isText = event.message.type === "text";
  const isImage = event.message.type === "image";

  if (!isText && !isImage) {
    if (event.replyToken) {
      await replyMessage(event.replyToken, [
        {
          type: "text",
          text: "ขออภัยค่ะ ระบบรองรับเฉพาะข้อความและรูปภาพ รบกวนพิมพ์รายละเอียดหรือส่งรูปภาพมาได้เลยค่ะ",
        },
      ]);
    }
    return;
  }

  const profile = await getLineProfile(userId);
  const { lead, conversation } = await getOrCreateLeadAndConversation(userId, profile?.displayName);

  const recent = await prisma.message.findMany({
    where: { conversationId: conversation.id, role: { in: [MessageRole.USER, MessageRole.BOT] } },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
  });
  const history: ChatTurn[] = recent
    .reverse()
    .map((m) => ({ role: m.role === MessageRole.USER ? "user" : "model", text: m.content }));

  const image = isImage ? await getLineImageContent(event.message.id) : undefined;

  const ai = await generateChatReply({
    history,
    userMessage: isText ? (event.message.text ?? "") : "",
    image,
  });

  // For photos we keep only the AI's text summary, never the original file
  // (docs/AI_POLICY.md §4).
  const userContent = isImage
    ? (ai.imageDescription ?? "(ลูกค้าส่งรูปภาพมา)")
    : (event.message.text ?? "");

  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role: MessageRole.USER,
      content: userContent,
      hasImage: isImage,
      topic: ai.topic,
      sentiment: ai.sentiment,
    },
  });
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
  if (event.replyToken) {
    try {
      await replyMessage(event.replyToken, [{ type: "text", text: ai.reply }]);
    } catch (err) {
      console.error("[line-webhook] reply failed", err);
    }
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
