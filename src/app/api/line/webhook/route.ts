import { NextResponse, after } from "next/server";
import { verifyLineSignature, replyMessage, getLineProfile } from "@/lib/line";
import { getOrCreateLeadAndConversation } from "@/lib/lead";
import { enqueueMessage, processAfterDebounce } from "@/lib/inbox";
import { PERSONA } from "@/lib/policy";

export const runtime = "nodejs";

// The reply waits out the debounce window before the AI call, so the invocation
// must be allowed to live longer than a normal request. The hosting plan may cap
// this lower — if replies stop arriving, lower MESSAGE_DEBOUNCE_MS.
export const maxDuration = 60;

const GREETING = [
  `สวัสดีค่ะ 🙏 ที่นี่ A5 Design by Asset Five (ออกแบบและก่อสร้างครบวงจร turn-key)`,
  `${PERSONA.name}เป็นผู้ช่วย AI ที่คอยรับเรื่องเบื้องต้นตลอด 24 ชม. ก่อนส่งต่อให้ทีมงานติดต่อกลับค่ะ`,
  "",
  "ข้อมูลที่ท่านแจ้ง (เช่น ชื่อ เบอร์ติดต่อ รายละเอียดงาน) จะถูกเก็บเพื่อให้ทีมงานติดต่อกลับ และอาจใช้ข้อมูลบทสนทนาแบบไม่ระบุตัวบุคคลเพื่อพัฒนาบริการ หากไม่ประสงค์ให้เก็บข้อมูล แจ้งได้ทุกเมื่อค่ะ",
  "",
  "รบกวนเล่าคร่าว ๆ ได้เลยค่ะว่าสนใจงานลักษณะใด (เช่น สร้างบ้านใหม่ รีโนเวท ต่อเติม หรือออกแบบ)",
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

  if (!event.replyToken) return;

  await enqueueMessage({
    lineUserId: userId,
    lineMessageId: event.message.id,
    kind: isText ? "text" : "image",
    text: isText ? (event.message.text ?? "") : "",
    replyToken: event.replyToken,
  });

  // LINE gets its 200 straight away; the customer's message burst is merged and
  // answered once, after the debounce window, in the background.
  const messageId = event.message.id;
  after(async () => {
    try {
      await processAfterDebounce(userId, messageId);
    } catch (err) {
      console.error("[line-webhook] deferred processing failed", err);
    }
  });
}
