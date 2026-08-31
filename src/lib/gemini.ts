import { GoogleGenerativeAI, SchemaType, type ResponseSchema } from "@google/generative-ai";
import { buildSystemPrompt } from "./policy";

export interface ChatTurn {
  role: "user" | "model";
  text: string;
}

export interface StructuredChatReply {
  reply: string;
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
    reply: { type: SchemaType.STRING, description: "ข้อความตอบกลับลูกค้า" },
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
  required: ["reply", "extractedFields", "needsHuman"],
};

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
  image?: { base64: string; mimeType: string };
}): Promise<StructuredChatReply> {
  const userParts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [];
  if (params.image) {
    userParts.push({ inlineData: { data: params.image.base64, mimeType: params.image.mimeType } });
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
      model: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",
      systemInstruction: buildSystemPrompt(),
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema,
        temperature: 0.3,
      },
    });
    const result = await model.generateContent({ contents });
    return JSON.parse(result.response.text()) as StructuredChatReply;
  } catch (err) {
    console.error("[gemini] falling back to human handoff", err);
    return {
      reply:
        "ขออภัยค่ะ ระบบผู้ช่วยอัตโนมัติไม่พร้อมใช้งานชั่วคราว ดิฉันได้แจ้งทีมงานให้ติดต่อกลับโดยเร็วที่สุดแล้วค่ะ 🙏",
      extractedFields: {},
      needsHuman: true,
      escalationReason: "ai_unavailable",
    };
  }
}
