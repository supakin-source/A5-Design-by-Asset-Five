// Detects messages that close a thought rather than ask for anything —
// "ขอบคุณครับ", "โอเค", "thanks", a lone 👍. A receptionist does not answer
// those, and answering costs a Gemini request out of a small daily quota, so
// they are filtered out before the AI is called at all.
//
// The matcher is deliberately conservative: anything that could carry a request
// (a question, a phone number, extra words) falls through to the AI.

const ACK_PHRASES = [
  // Thai — thanks
  "ขอบคุณมากครับ",
  "ขอบคุณมากค่ะ",
  "ขอบคุณมากนะครับ",
  "ขอบคุณมากนะคะ",
  "ขอบคุณครับ",
  "ขอบคุณค่ะ",
  "ขอบคุณนะครับ",
  "ขอบคุณนะคะ",
  "ขอบคุณมาก",
  "ขอบคุณ",
  "ขอบใจ",
  "ขอบคุน",
  // Thai — acknowledgement / agreement
  "รับทราบแล้ว",
  "รับทราบ",
  "ทราบแล้ว",
  "เข้าใจแล้ว",
  "โอเคเลย",
  "โอเค",
  "โอเคร",
  "ตกลง",
  "ได้เลย",
  "ได้ครับ",
  "ได้ค่ะ",
  "จัดไป",
  "เยี่ยม",
  "ดีเลย",
  "สุดยอด",
  // Thai — closing
  "แล้วเจอกัน",
  "ไว้คุยกันใหม่",
  "บาย",
  "ไปก่อนนะ",
  // Thai — bare particles
  "ครับผม",
  "คร้าบ",
  "ครับ",
  "คับ",
  "ค่ะ",
  "คะ",
  "ค้าบ",
  "จ้า",
  "จ้าา",
  "จ๊ะ",
  "จ้ะ",
  "จร้า",
  "อืม",
  "อือ",
  "โอเคค่ะ",
  "โอเคครับ",
  // English
  "thank you so much",
  "thank you very much",
  "thank you",
  "thanks a lot",
  "thanks",
  "thx",
  "ty",
  "noted",
  "got it",
  "understood",
  "okay",
  "okey",
  "ok",
  "alright",
  "cool",
  "great",
  "perfect",
  "sure",
  "bye",
  "see you",
  "cheers",
]
  // Longest first so "ขอบคุณมากครับ" is consumed before "ขอบคุณ".
  .sort((a, b) => b.length - a.length);

const MAX_ACK_LENGTH = 40;
const QUESTION_MARK = /[?？]/;
const DIGITS = /\d/;

function stripDecoration(text: string): string {
  return text
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isPureAcknowledgement(rawText: string): boolean {
  const text = rawText.trim();
  if (!text) return false;

  // An emoji- or sticker-only message carries no request.
  const withoutDecoration = stripDecoration(text);
  if (withoutDecoration === "") return true;

  // Anything that asks something, or carries a number the team might need
  // (phone, budget, area), is never treated as a closing message.
  if (QUESTION_MARK.test(text)) return false;
  if (DIGITS.test(text)) return false;
  if (withoutDecoration.length > MAX_ACK_LENGTH) return false;

  let remainder = withoutDecoration.toLowerCase();
  for (const phrase of ACK_PHRASES) {
    remainder = remainder.split(phrase).join(" ");
  }

  // Everything that was said is accounted for by acknowledgement phrases.
  return remainder.replace(/\s+/g, "") === "";
}

// A burst counts as an acknowledgement only when every fragment is one.
export function isAcknowledgementOnlyBatch(texts: string[]): boolean {
  const meaningful = texts.filter((t) => t.trim().length > 0);
  if (meaningful.length === 0) return false;
  return meaningful.every(isPureAcknowledgement);
}
