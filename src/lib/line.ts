import crypto from "node:crypto";

const LINE_API = "https://api.line.me/v2/bot";
const LINE_DATA_API = "https://api-data.line.me/v2/bot";

export function verifyLineSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret || !signature) return false;
  const hash = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  // timingSafeEqual requires equal-length buffers; mismatched length just means "not equal"
  const a = Buffer.from(hash);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function authHeaders() {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error("LINE_CHANNEL_ACCESS_TOKEN is not set");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

// Message shapes accepted by the reply/push endpoints. Text is all the bot
// sends today; Flex and quick replies are here so richer messages (service
// cards, "เลือกประเภทงาน" buttons) can be added without touching the senders.
export type LineAction =
  | { type: "message"; label: string; text: string }
  | { type: "postback"; label?: string; data: string; displayText?: string }
  | { type: "uri"; label?: string; uri: string }
  | {
      type: "datetimepicker";
      label?: string;
      data: string;
      mode: "date" | "time" | "datetime";
      initial?: string;
      min?: string;
      max?: string;
    }
  | { type: "camera"; label: string }
  | { type: "cameraRoll"; label: string }
  | { type: "location"; label: string };

export interface LineQuickReply {
  items: Array<{ type: "action"; imageUrl?: string; action: LineAction }>;
}

// The Flex container schema is large and evolves with the LINE API; it is kept
// loose here on purpose and validated by LINE itself on send.
export type FlexContainer = Record<string, unknown>;

export type LineMessage =
  | { type: "text"; text: string; quickReply?: LineQuickReply }
  | { type: "flex"; altText: string; contents: FlexContainer; quickReply?: LineQuickReply };

export async function replyMessage(replyToken: string, messages: LineMessage[]) {
  const res = await fetch(`${LINE_API}/message/reply`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!res.ok) {
    throw new Error(`LINE reply failed: ${res.status} ${await res.text()}`);
  }
}

export async function pushMessage(to: string, messages: LineMessage[]) {
  const res = await fetch(`${LINE_API}/message/push`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ to, messages }),
  });
  if (!res.ok) {
    throw new Error(`LINE push failed: ${res.status} ${await res.text()}`);
  }
}

export async function getLineProfile(userId: string): Promise<{ displayName?: string } | null> {
  const res = await fetch(`${LINE_API}/profile/${userId}`, { headers: authHeaders() });
  if (!res.ok) return null;
  return res.json();
}

// Fetches an image message's binary content, for passing to Gemini vision.
// Callers should use the result immediately and not persist it — see
// docs/AI_POLICY.md (no long-term storage of the customer's original photo).
export async function getLineImageContent(messageId: string): Promise<{ base64: string; mimeType: string }> {
  const res = await fetch(`${LINE_DATA_API}/message/${messageId}/content`, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`LINE content fetch failed: ${res.status} ${await res.text()}`);
  }
  const mimeType = res.headers.get("content-type") ?? "image/jpeg";
  const buffer = Buffer.from(await res.arrayBuffer());
  return { base64: buffer.toString("base64"), mimeType };
}
