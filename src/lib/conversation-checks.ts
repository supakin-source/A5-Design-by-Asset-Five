// Mechanical checks on what the bot says, used by the conversation simulator
// (scripts/simulate-chat.ts) to catch policy breaks without a human reading
// every transcript. Pure functions with no network or database access, so they
// can be unit-tested on their own.

import { MAX_BUBBLES } from "./gemini";

export type Severity = "error" | "warning";

export interface Violation {
  rule: string;
  severity: Severity;
  detail: string;
}

const SOFT_BUBBLE_CHARS = 160;
const HARD_BUBBLE_CHARS = 220;

export function checkBubbleShape(bubbles: string[]): Violation[] {
  const violations: Violation[] = [];

  if (bubbles.length === 0) {
    violations.push({ rule: "bubbles", severity: "error", detail: "ไม่มีข้อความตอบกลับ" });
  }
  if (bubbles.length > MAX_BUBBLES) {
    violations.push({
      rule: "bubbles",
      severity: "error",
      detail: `ตอบ ${bubbles.length} ฟอง เกินลิมิต ${MAX_BUBBLES}`,
    });
  }
  for (const bubble of bubbles) {
    if (bubble.length > HARD_BUBBLE_CHARS) {
      violations.push({
        rule: "bubbles",
        severity: "error",
        detail: `ฟองยาว ${bubble.length} ตัวอักษร (เกิน ${HARD_BUBBLE_CHARS})`,
      });
    } else if (bubble.length > SOFT_BUBBLE_CHARS) {
      violations.push({
        rule: "bubbles",
        severity: "warning",
        detail: `ฟองยาว ${bubble.length} ตัวอักษร (ควรไม่เกิน ${SOFT_BUBBLE_CHARS})`,
      });
    }
  }

  const emojiCount = (bubbles.join(" ").match(/\p{Extended_Pictographic}/gu) ?? []).length;
  if (emojiCount > 1) {
    violations.push({
      rule: "emoji",
      severity: "warning",
      detail: `ใช้อีโมจิ ${emojiCount} ตัวในคำตอบเดียว (ควรไม่เกิน 1)`,
    });
  }

  return violations;
}

// The bot must never name a callback time the company has not approved.
const CALLBACK_PROMISE =
  /(ภายใน|ไม่เกิน|อีก)\s*\d+\s*(นาที|ชั่วโมง|ชม\.?|วัน)|within\s+\d+\s+(minute|hour|day)/i;

export function checkNoCallbackPromise(bubbles: string[]): Violation[] {
  const text = bubbles.join(" ");
  const match = text.match(CALLBACK_PROMISE);
  if (!match) return [];
  return [
    {
      rule: "callback-promise",
      severity: "error",
      detail: `รับปากกรอบเวลาติดต่อกลับ: "${match[0].trim()}"`,
    },
  ];
}

// Quoting a price is forbidden, but repeating a figure the customer just gave
// (their own budget) is normal and must not be flagged.
const PRICE = /\d[\d,.]*\s*(บาท|ล้าน|แสน|หมื่น|baht|thb)/gi;

export function checkNoPriceQuote(bubbles: string[], customerText: string): Violation[] {
  const customerFigures = new Set((customerText.match(PRICE) ?? []).map((m) => m.replace(/\s+/g, "")));
  const violations: Violation[] = [];

  for (const match of bubbles.join(" ").matchAll(PRICE)) {
    const figure = match[0].replace(/\s+/g, "");
    if (customerFigures.has(figure)) continue; // echoing the customer's own number
    violations.push({
      rule: "price-quote",
      severity: "error",
      detail: `เอ่ยตัวเลขราคาที่ลูกค้าไม่ได้บอกมาก่อน: "${match[0].trim()}"`,
    });
  }

  return violations;
}

const THAI = /[฀-๿]/;
const LATIN_WORD = /[A-Za-z]{2,}/;

// The persona answers in the customer's language. Detection is deliberately
// coarse — it only catches a wholesale switch, not loanwords.
export function checkLanguageMatch(bubbles: string[], customerText: string): Violation[] {
  const reply = bubbles.join(" ");
  const customerThai = THAI.test(customerText);
  const customerLatin = LATIN_WORD.test(customerText.replace(PRICE, ""));
  const replyThai = THAI.test(reply);

  if (!customerThai && customerLatin && replyThai) {
    return [
      {
        rule: "language",
        severity: "error",
        detail: "ลูกค้าเขียนภาษาอังกฤษ แต่บอทตอบภาษาไทย",
      },
    ];
  }
  // Only a wholesale switch counts: a short reply that happens to carry no Thai
  // characters ("OK") is not the bot answering in the wrong language.
  const replyLatinWords = (reply.match(/[A-Za-z]{2,}/g) ?? []).length;
  if (customerThai && !replyThai && replyLatinWords >= 3) {
    return [
      {
        rule: "language",
        severity: "error",
        detail: "ลูกค้าเขียนภาษาไทย แต่บอทตอบเป็นภาษาอื่น",
      },
    ];
  }
  return [];
}

export function runAllChecks(bubbles: string[], customerText: string): Violation[] {
  return [
    ...checkBubbleShape(bubbles),
    ...checkNoCallbackPromise(bubbles),
    ...checkNoPriceQuote(bubbles, customerText),
    ...checkLanguageMatch(bubbles, customerText),
  ];
}
