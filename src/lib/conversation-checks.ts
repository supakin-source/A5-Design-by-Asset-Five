// Mechanical checks on what the bot says, used by the conversation simulator
// (scripts/simulate-chat.ts) to catch policy breaks without a human reading
// every transcript. Pure functions with no network or database access, so they
// can be unit-tested on their own.

import { MAX_BUBBLES } from "./gemini";
import { PERSONA } from "./policy";

export type Severity = "error" | "warning";

export interface Violation {
  rule: string;
  severity: Severity;
  detail: string;
}

const SOFT_BUBBLE_CHARS = 160;
const HARD_BUBBLE_CHARS = 200;

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

// Templated "here is why I'm asking" openers. One is tolerable; the same device
// on every turn is what makes a bot read like a script being recited.
const PURPOSE_CLAUSES = [
  /เพื่อให้ทีม\s*งาน/,
  /เพื่อให้ข้อมูล/,
  /เพื่อให้การประเมิน/,
  /เพื่อความถูกต้อง/,
  /เพื่อประกอบการ/,
  /to (?:help|better help) me/i,
  /in order to (?:better )?(?:serve|assist|help)/i,
  /so (?:that )?our team can/i,
];

function countPurposeClauses(text: string): number {
  return PURPOSE_CLAUSES.reduce((total, pattern) => {
    const matches = text.match(new RegExp(pattern.source, pattern.flags.includes("i") ? "gi" : "g"));
    return total + (matches?.length ?? 0);
  }, 0);
}

export interface ConversationContext {
  /** 0 for the first turn of the conversation. */
  turnIndex: number;
  /** Bubbles the bot has already sent in this conversation, newest last. */
  previousReplies: string[][];
}

export function checkNotScripted(bubbles: string[], context?: ConversationContext): Violation[] {
  const violations: Violation[] = [];
  const text = bubbles.join(" ");

  const here = countPurposeClauses(text);
  const earlier = (context?.previousReplies ?? []).filter((reply) => countPurposeClauses(reply.join(" ")) > 0).length;

  if (here > 1) {
    violations.push({
      rule: "scripted-phrasing",
      severity: "error",
      detail: `ใช้วลีอธิบายเหตุผลสำเร็จรูป ${here} ครั้งในคำตอบเดียว`,
    });
  } else if (here === 1 && earlier > 0) {
    violations.push({
      rule: "scripted-phrasing",
      severity: "error",
      detail: `ใช้วลีอธิบายเหตุผลสำเร็จรูปซ้ำ (เคยใช้มาแล้ว ${earlier} เทิร์นในบทสนทนานี้)`,
    });
  } else if (here === 1) {
    violations.push({
      rule: "scripted-phrasing",
      severity: "warning",
      detail: "ขึ้นต้นด้วยวลีอธิบายเหตุผล — ถามตรง ๆ จะเป็นธรรมชาติกว่า",
    });
  }

  // Saying its own name every turn reads like a script; it belongs in the
  // introduction only.
  const nameMatches = text.match(new RegExp(PERSONA.name, "g"))?.length ?? 0;
  const isFirstTurn = (context?.turnIndex ?? 0) === 0;
  if (nameMatches >= 2) {
    violations.push({
      rule: "self-name",
      severity: "error",
      detail: `เอ่ยชื่อ "${PERSONA.name}" ${nameMatches} ครั้งในคำตอบเดียว`,
    });
  } else if (nameMatches === 1 && !isFirstTurn) {
    violations.push({
      rule: "self-name",
      severity: "warning",
      detail: `เอ่ยชื่อ "${PERSONA.name}" หลังแนะนำตัวไปแล้ว`,
    });
  }

  return violations;
}

export function runAllChecks(
  bubbles: string[],
  customerText: string,
  context?: ConversationContext,
): Violation[] {
  return [
    ...checkBubbleShape(bubbles),
    ...checkNoCallbackPromise(bubbles),
    ...checkNoPriceQuote(bubbles, customerText),
    ...checkLanguageMatch(bubbles, customerText),
    ...checkNotScripted(bubbles, context),
  ];
}
