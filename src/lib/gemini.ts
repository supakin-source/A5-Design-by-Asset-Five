import { GoogleGenerativeAI, SchemaType, type ResponseSchema } from "@google/generative-ai";
import { buildSystemPrompt } from "./policy";

export interface ChatTurn {
  role: "user" | "model";
  text: string;
}

export interface StructuredChatReply {
  // One entry per chat bubble. People send a thought as a couple of short
  // messages rather than one paragraph, so the bot answers the same way.
  replies: string[];
  extractedFields: {
    name?: string;
    phone?: string;
    projectType?: string;
    budgetRange?: string;
    location?: string;
    timeline?: string;
    contactNote?: string;
  };
  topic?: string;
  sentiment?: "positive" | "neutral" | "negative";
  needsHuman: boolean;
  escalationReason?: string;
  // Text summary of a photo the customer sent; stored in place of the image itself.
  imageDescription?: string;
}

const responseSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    replies: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: "ข้อความตอบกลับลูกค้า แบ่งเป็น 1-3 ฟองแชท ฟองละ 1-2 ประโยคสั้น",
    },
    extractedFields: {
      type: SchemaType.OBJECT,
      properties: {
        name: { type: SchemaType.STRING, nullable: true },
        phone: { type: SchemaType.STRING, nullable: true },
        projectType: { type: SchemaType.STRING, nullable: true },
        budgetRange: { type: SchemaType.STRING, nullable: true },
        location: { type: SchemaType.STRING, nullable: true },
        timeline: { type: SchemaType.STRING, nullable: true },
        contactNote: { type: SchemaType.STRING, nullable: true },
      },
    },
    topic: { type: SchemaType.STRING, nullable: true },
    sentiment: {
      type: SchemaType.STRING,
      enum: ["positive", "neutral", "negative"],
      format: "enum",
      nullable: true,
    } as ResponseSchema,
    needsHuman: { type: SchemaType.BOOLEAN },
    escalationReason: { type: SchemaType.STRING, nullable: true },
    imageDescription: { type: SchemaType.STRING, nullable: true },
  },
  required: ["replies", "extractedFields", "needsHuman"],
};

export const MAX_BUBBLES = 3;
const MAX_BUBBLE_CHARS = 220;

// Guards against the model ignoring the bubble limits: drops empties, splits an
// over-long bubble at a sentence boundary rather than mid-word, and never sends
// more bubbles than a person would.
export function normalizeBubbles(replies: unknown): string[] {
  const raw = Array.isArray(replies) ? replies : [replies];
  const bubbles: string[] = [];

  for (const entry of raw) {
    const text = typeof entry === "string" ? entry.trim() : "";
    if (!text) continue;
    if (text.length <= MAX_BUBBLE_CHARS) {
      bubbles.push(text);
      continue;
    }
    let rest = text;
    while (rest.length > MAX_BUBBLE_CHARS) {
      const window = rest.slice(0, MAX_BUBBLE_CHARS);
      const cut = Math.max(window.lastIndexOf(" "), window.lastIndexOf("\n"));
      const at = cut > MAX_BUBBLE_CHARS / 2 ? cut : MAX_BUBBLE_CHARS;
      bubbles.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) bubbles.push(rest);
  }

  return bubbles.slice(0, MAX_BUBBLES);
}

let client: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  if (!client) client = new GoogleGenerativeAI(apiKey);
  return client;
}

export async function generateChatReply(params: {
  history: ChatTurn[];
  userMessage: string;
  images?: Array<{ base64: string; mimeType: string }>;
}): Promise<StructuredChatReply> {
  const userParts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [];
  for (const image of params.images ?? []) {
    userParts.push({ inlineData: { data: image.base64, mimeType: image.mimeType } });
  }
  userParts.push({ text: params.userMessage || "(ลูกค้าส่งรูปภาพมาโดยไม่มีข้อความ)" });

  const contents = [
    ...params.history.map((turn) => ({ role: turn.role, parts: [{ text: turn.text }] })),
    { role: "user" as const, parts: userParts },
  ];

  // Any AI failure (quota exhausted on the free tier, network error, or a reply
  // that doesn't match the schema) falls back to a human handoff, so the
  // customer is never left without an answer — see docs/AI_POLICY.md §3.
  try {
    const model = getClient().getGenerativeModel({
      // Google retires model IDs on a schedule (gemini-2.0-flash was shut down
      // 2026-06-01), so check the current model list when calls start failing
      // with 404 and override GEMINI_MODEL rather than editing this default.
      model: process.env.GEMINI_MODEL ?? "gemini-3.5-flash",
      systemInstruction: buildSystemPrompt(),
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema,
        temperature: 0.3,
      },
    });
    const result = await model.generateContent({ contents });
    const parsed = JSON.parse(result.response.text()) as StructuredChatReply;
    const replies = normalizeBubbles(parsed.replies);
    if (replies.length === 0) throw new Error("model returned no reply text");
    return { ...parsed, replies };
  } catch (err) {
    console.error("[gemini] falling back to human handoff", err);
    return {
      replies: [
        "ขออภัยค่ะ ระบบผู้ช่วยอัตโนมัติไม่พร้อมใช้งานชั่วคราว",
        "Ady แจ้งทีมงานให้ติดต่อกลับโดยเร็วที่สุดแล้วนะคะ 🙏",
      ],
      extractedFields: {},
      needsHuman: true,
      escalationReason: "ai_unavailable",
    };
  }
}
