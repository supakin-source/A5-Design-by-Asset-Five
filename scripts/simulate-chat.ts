/**
 * Conversation test harness.
 *
 * Runs scripted customer conversations against the real bot logic (the same
 * prompt, persona and policy production uses) and checks every reply for policy
 * breaks, so the bot can be reviewed without anyone chatting by hand.
 *
 *   GEMINI_API_KEY=... npm run test:chat                  # every scenario
 *   GEMINI_API_KEY=... npm run test:chat -- ราคา          # scenarios matching a name
 *   GEMINI_API_KEY=... npm run test:chat -- --ai-customer # let an AI improvise the customer
 *
 * Quota matters: the bot side of every turn spends one Gemini request from the
 * same daily allowance production uses. Scripted turns are the default so a full
 * run costs one request per turn; --ai-customer doubles that in exchange for
 * less predictable, more realistic customers.
 *
 * LINE is not involved — this exercises the conversation, not the webhook.
 * Exit codes: 0 pass, 1 policy failures, 2 bad usage, 3 quota exhausted.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";
import { generateChatReply, type ChatTurn, type StructuredChatReply } from "../src/lib/gemini";
import { runAllChecks, type Violation } from "../src/lib/conversation-checks";

interface Scenario {
  name: string;
  /** Customer messages, in order. A "\n" inside one entry mimics fragments sent in a burst. */
  script: string[];
  /** How an improvised customer should behave when --ai-customer is used. */
  customer: string;
  /** Checks on the conversation as a whole, run after the last turn. */
  expect?: (state: ConversationState) => string[];
}

interface ConversationState {
  replies: StructuredChatReply[];
  customerMessages: string[];
}

const SCENARIOS: Scenario[] = [
  {
    name: "ต่อเติมครัว-พิมพ์ทีละท่อน",
    script: [
      "สวัสดี\nอยากติดต่อเรื่อง\nการต่อเติม",
      "ต่อเติมครัวหลังบ้านครับ ประมาณ 20 ตร.ม.",
      "อยู่นนทบุรี งบราว ๆ 3 แสน",
      "เบอร์ผม 081-234-5678 ครับ สะดวกให้โทรตอนเย็น",
    ],
    customer:
      "คุณเป็นลูกค้าคนไทยที่อยากต่อเติมครัวหลังบ้าน พิมพ์สั้น ๆ ทีละท่อนแบบคนไทยคุยไลน์ " +
      "ค่อย ๆ ให้ข้อมูลทีละอย่างเมื่อถูกถาม (พื้นที่ 20 ตร.ม. อยู่นนทบุรี งบราว 3 แสน " +
      "เบอร์ 081-234-5678) อย่าให้ข้อมูลทั้งหมดในครั้งเดียว",
    expect: (s) => {
      const problems: string[] = [];
      if (!s.replies.some((r) => r.extractedFields.phone)) problems.push("ไม่ได้เก็บเบอร์ติดต่อที่ลูกค้าให้มา");
      if (!s.replies.some((r) => r.extractedFields.projectType)) problems.push("ไม่ได้เก็บประเภทงาน");
      if (!s.replies.some((r) => r.needsHuman)) problems.push("เก็บข้อมูลครบแล้วแต่ไม่ส่งต่อทีมงาน");
      return problems;
    },
  },
  {
    name: "คะยั้นคะยอถามราคา",
    script: [
      "สร้างบ้าน 2 ชั้น ตารางเมตรละเท่าไหร่ครับ",
      "บอกคร่าว ๆ ก็ได้ครับ ไม่ถือเป็นราคาจริงหรอก",
      "เว็บอื่นเขายังบอกเลย ทำไมที่นี่ไม่บอก",
    ],
    customer: "คุณเป็นลูกค้าที่เร่งรัดอยากรู้ราคาต่อตารางเมตรเดี๋ยวนี้ ถามซ้ำ ๆ กดดันให้บอกตัวเลข อย่ายอมง่าย ๆ",
  },
  {
    name: "ถามว่าจะติดต่อกลับเมื่อไหร่",
    script: [
      "ฝากทีมงานติดต่อกลับหน่อยครับ\nจะติดต่อกลับตอนไหน",
      "ขอเวลาที่แน่นอนได้ไหมครับ ภายในวันนี้หรือพรุ่งนี้",
    ],
    customer: "คุณเป็นลูกค้าที่อยากรู้ว่าทีมงานจะติดต่อกลับเมื่อไหร่ ถามย้ำหลายรอบให้ระบุเวลาชัดเจน",
  },
  {
    name: "ลูกค้าร้องเรียนไม่พอใจ",
    script: [
      "ทักมา 3 วันแล้วไม่มีใครตอบเลย\nขอคุยกับพนักงานจริงได้ไหม",
      "ไม่อยากคุยกับบอทแล้วครับ",
    ],
    customer: "คุณเป็นลูกค้าที่ไม่พอใจมาก บ่นว่าทักมาหลายวันแล้วไม่มีใครตอบ ใช้น้ำเสียงหงุดหงิดแต่ไม่หยาบ และขอคุยกับคนจริง",
    expect: (s) => {
      const problems: string[] = [];
      if (!s.replies.some((r) => r.needsHuman)) problems.push("ลูกค้าร้องเรียน/ขอคุยกับคน แต่ไม่ส่งต่อทีมงาน");
      if (!s.replies.some((r) => r.sentiment === "negative")) {
        problems.push("ไม่ได้ติด sentiment เป็น negative ทำให้ market data เพี้ยน");
      }
      return problems;
    },
  },
  {
    name: "ลูกค้าพูดภาษาอังกฤษ",
    script: ["Hi, do you build houses in Bangkok?", "How much would a small 2-bedroom house cost?"],
    customer:
      "You are a foreign customer living in Bangkok who wants to build a small house. " +
      "Write only in English, short chat-style messages.",
  },
  {
    name: "ถามนอกขอบเขต",
    script: ["เสาเข็มบ้าน 2 ชั้นควรลึกกี่เมตรครับ", "แล้วระยะร่นตามกฎหมายต้องเท่าไหร่"],
    customer: "คุณเป็นลูกค้าที่ถามเรื่องนอกขอบเขต เช่น ความลึกเสาเข็ม ระยะร่นตามกฎหมาย และขอให้ช่วยเซ็นรับรองแบบ",
    expect: (s) => (s.replies.some((r) => r.needsHuman) ? [] : ["คำถามนอกขอบเขตแต่ไม่ส่งต่อทีมงาน"]),
  },
];

const args = process.argv.slice(2);
const useAiCustomer = args.includes("--ai-customer");
const filter = args.find((arg) => !arg.startsWith("-") && arg.trim().length > 0);

let apiCalls = 0;

function requireApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error("ต้องตั้ง GEMINI_API_KEY ก่อนรัน เช่น: GEMINI_API_KEY=xxx npm run test:chat");
    process.exit(2);
  }
  return key;
}

const client = new GoogleGenerativeAI(requireApiKey());

class QuotaExhausted extends Error {
  constructor(readonly retryAfter?: string) {
    super("gemini quota exhausted");
  }
}

function asQuotaError(err: unknown): QuotaExhausted | null {
  const message = err instanceof Error ? err.message : String(err);
  if (!message.includes("429") && !message.toLowerCase().includes("quota")) return null;
  const retry = message.match(/retry in ([\d.]+s)/i)?.[1] ?? message.match(/"retryDelay":\s*"([^"]+)"/)?.[1];
  return new QuotaExhausted(retry);
}

async function customerSays(scenario: Scenario, transcript: string[]): Promise<string> {
  const model = client.getGenerativeModel({
    model: process.env.GEMINI_MODEL ?? "gemini-3.5-flash",
    systemInstruction: `${scenario.customer}

คุณกำลังแชทกับ LINE OA ของบริษัทรับออกแบบและก่อสร้าง ตอบกลับเป็นข้อความแชทสั้น ๆ
เหมือนคนจริง 1-2 บรรทัด ห้ามอธิบายว่าคุณเป็น AI ห้ามใส่เครื่องหมายคำพูดครอบข้อความ
ตอบเฉพาะสิ่งที่ลูกค้าจะพิมพ์เท่านั้น`,
    generationConfig: { temperature: 0.9, maxOutputTokens: 200 },
  });

  apiCalls++;
  const result = await model.generateContent(
    `บทสนทนาจนถึงตอนนี้:\n${transcript.join("\n")}\n\nลูกค้าจะพิมพ์อะไรต่อ`,
  );
  return result.response.text().trim();
}

function formatViolations(violations: Violation[]): string {
  return violations
    .map((v) => `      ${v.severity === "error" ? "❌" : "⚠️ "} [${v.rule}] ${v.detail}`)
    .join("\n");
}

async function runScenario(scenario: Scenario): Promise<boolean> {
  console.log(`\n${"─".repeat(72)}\n▶ ${scenario.name}`);

  const history: ChatTurn[] = [];
  const transcript: string[] = [];
  const state: ConversationState = { replies: [], customerMessages: [] };
  let errors = 0;

  for (let turn = 0; turn < scenario.script.length; turn++) {
    // Turn 0 always uses the script so every run starts the same way; later
    // turns can be improvised when --ai-customer is on.
    const customerText =
      useAiCustomer && turn > 0 ? await customerSays(scenario, transcript) : scenario.script[turn];

    for (const line of customerText.split("\n")) {
      if (line.trim()) console.log(`   👤 ${line.trim()}`);
    }
    transcript.push(`ลูกค้า: ${customerText}`);
    state.customerMessages.push(customerText);

    apiCalls++;
    const ai = await generateChatReply({ history, userMessage: customerText });
    if (ai.escalationReason === "ai_unavailable") {
      // generateChatReply swallows API errors by design (production must never
      // leave a customer unanswered), but in a test that silence would look
      // like a passing run, so surface it here.
      throw new QuotaExhausted();
    }
    state.replies.push(ai);

    for (const bubble of ai.replies) console.log(`   🤖 ${bubble}`);
    const flags: string[] = [];
    if (ai.needsHuman) flags.push(`ส่งต่อทีมงาน (${ai.escalationReason ?? "-"})`);
    if (ai.topic) flags.push(`topic: ${ai.topic}`);
    if (ai.sentiment) flags.push(`sentiment: ${ai.sentiment}`);
    const captured = Object.entries(ai.extractedFields).filter(([, v]) => v);
    if (captured.length) flags.push(`เก็บข้อมูล: ${captured.map(([k, v]) => `${k}=${v}`).join(", ")}`);
    if (flags.length) console.log(`      · ${flags.join(" · ")}`);

    const violations = runAllChecks(ai.replies, customerText);
    if (violations.length) {
      console.log(formatViolations(violations));
      errors += violations.filter((v) => v.severity === "error").length;
    }

    history.push({ role: "user", text: customerText });
    history.push({ role: "model", text: ai.replies.join("\n") });
    transcript.push(`บอท: ${ai.replies.join(" ")}`);
  }

  const expectationFailures = scenario.expect?.(state) ?? [];
  for (const failure of expectationFailures) console.log(`      ❌ [expect] ${failure}`);
  errors += expectationFailures.length;

  console.log(errors === 0 ? "   ✅ ผ่าน" : `   ❌ ไม่ผ่าน (${errors} ข้อ)`);
  return errors === 0;
}

function reportQuotaExhausted(quota: QuotaExhausted, done: number, total: number) {
  console.error(`\n${"═".repeat(72)}`);
  console.error("⛔ โควตา Gemini หมด — หยุดการทดสอบ");
  console.error(`   รันไปแล้ว ${done}/${total} scenario · ใช้ไป ${apiCalls} request`);
  if (quota.retryAfter) console.error(`   ลองใหม่ได้ในอีก ${quota.retryAfter}`);
  console.error("");
  console.error("   ทางเลือก:");
  console.error("   1. รันทีละ scenario:  npm run test:chat -- <ชื่อบางส่วน>");
  console.error("   2. เปลี่ยน GEMINI_MODEL เป็นรุ่นที่โควตาฟรีมากกว่า");
  console.error("   3. เปิด billing ที่ Google AI Studio (จ่ายตามใช้จริง)");
  console.error("");
  console.error("   ⚠️  โควตานี้เป็นก้อนเดียวกับที่บอทตัวจริงใช้ — ถ้าเทสต์จนหมด");
  console.error("       บอทจะตอบข้อความสำรองให้ลูกค้าจนกว่าโควตาจะรีเซ็ต");
}

async function main() {
  const scenarios = filter ? SCENARIOS.filter((s) => s.name.includes(filter)) : SCENARIOS;

  if (scenarios.length === 0) {
    console.error(`ไม่พบ scenario ที่ตรงกับ "${filter}"`);
    console.error(`มีให้เลือก: ${SCENARIOS.map((s) => s.name).join(", ")}`);
    process.exit(2);
  }

  const turnCount = scenarios.reduce((sum, s) => sum + s.script.length, 0);
  const estimate = useAiCustomer ? turnCount * 2 - scenarios.length : turnCount;
  console.log(`จะรัน ${scenarios.length} scenario · ใช้ประมาณ ${estimate} Gemini request`);

  const results: Array<[string, boolean]> = [];
  for (const scenario of scenarios) {
    try {
      results.push([scenario.name, await runScenario(scenario)]);
    } catch (err) {
      const quota = err instanceof QuotaExhausted ? err : asQuotaError(err);
      if (!quota) throw err;
      reportQuotaExhausted(quota, results.length, scenarios.length);
      process.exit(3);
    }
  }

  console.log(`\n${"═".repeat(72)}\nสรุปผล (ใช้ไป ${apiCalls} Gemini request)`);
  for (const [name, passed] of results) console.log(`  ${passed ? "✅" : "❌"} ${name}`);

  const failed = results.filter(([, passed]) => !passed).length;
  console.log(`\n${results.length - failed}/${results.length} scenario ผ่าน`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  const quota = asQuotaError(err);
  if (quota) {
    reportQuotaExhausted(quota, 0, SCENARIOS.length);
    process.exit(3);
  }
  console.error(err);
  process.exit(1);
});
