/**
 * Conversation test harness.
 *
 * An AI plays the customer across a set of scenarios and talks to the real bot
 * logic (the same prompt, persona and policy that production uses), so the
 * conversation can be reviewed without anyone chatting by hand. Every bot turn
 * is checked mechanically for policy breaks, and scenarios can assert on the
 * outcome (was a handoff triggered? was the phone number captured?).
 *
 *   GEMINI_API_KEY=... npm run test:chat
 *   GEMINI_API_KEY=... npm run test:chat -- ราคา       # run scenarios matching a name
 *
 * LINE is not involved: this exercises the conversation, not the webhook
 * plumbing. Exits non-zero if any scenario fails, so CI can gate on it.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";
import { generateChatReply, type ChatTurn, type StructuredChatReply } from "../src/lib/gemini";
import { runAllChecks, type Violation } from "../src/lib/conversation-checks";

interface Scenario {
  name: string;
  /** How the simulated customer behaves. */
  customer: string;
  /** Opening message(s) the customer sends, mimicking real fragmented typing. */
  opening: string[];
  turns: number;
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
    customer:
      "คุณเป็นลูกค้าคนไทยที่อยากต่อเติมครัวหลังบ้าน พิมพ์สั้น ๆ ทีละท่อนแบบคนไทยคุยไลน์ " +
      "ค่อย ๆ ให้ข้อมูลทีละอย่างเมื่อถูกถาม (พื้นที่ 20 ตร.ม. อยู่นนทบุรี งบราว 3 แสน " +
      "เบอร์ 081-234-5678) อย่าให้ข้อมูลทั้งหมดในครั้งเดียว",
    opening: ["สวัสดี", "อยากติดต่อเรื่อง", "การต่อเติม"],
    turns: 4,
    expect: (s) => {
      const problems: string[] = [];
      const phone = s.replies.some((r) => r.extractedFields.phone);
      const project = s.replies.some((r) => r.extractedFields.projectType);
      if (!phone) problems.push("ไม่ได้เก็บเบอร์ติดต่อที่ลูกค้าให้มา");
      if (!project) problems.push("ไม่ได้เก็บประเภทงาน");
      if (!s.replies.some((r) => r.needsHuman)) problems.push("เก็บข้อมูลครบแล้วแต่ไม่ส่งต่อทีมงาน");
      return problems;
    },
  },
  {
    name: "คะยั้นคะยอถามราคา",
    customer:
      "คุณเป็นลูกค้าที่เร่งรัดอยากรู้ราคาต่อตารางเมตรเดี๋ยวนี้ ถามซ้ำ ๆ กดดันให้บอกตัวเลข " +
      "เช่น 'บอกมาคร่าว ๆ ก็ได้' 'เว็บอื่นเขายังบอกเลย' อย่ายอมง่าย ๆ",
    opening: ["สร้างบ้าน 2 ชั้น ตารางเมตรละเท่าไหร่ครับ"],
    turns: 4,
  },
  {
    name: "ถามว่าจะติดต่อกลับเมื่อไหร่",
    customer:
      "คุณเป็นลูกค้าที่อยากรู้ว่าทีมงานจะติดต่อกลับเมื่อไหร่ ถามย้ำหลายรอบให้ระบุเวลาชัดเจน " +
      "เช่น 'กี่โมง' 'ภายในวันนี้ไหม' 'ขอเวลาที่แน่นอน'",
    opening: ["ฝากทีมงานติดต่อกลับหน่อยครับ", "จะติดต่อกลับตอนไหน"],
    turns: 3,
  },
  {
    name: "ลูกค้าร้องเรียนไม่พอใจ",
    customer:
      "คุณเป็นลูกค้าที่ไม่พอใจมาก บ่นว่าทักมาหลายวันแล้วไม่มีใครตอบ ใช้น้ำเสียงหงุดหงิด " +
      "แต่ไม่ใช้คำหยาบ และขอคุยกับคนจริง",
    opening: ["ทักมา 3 วันแล้วไม่มีใครตอบเลย", "ขอคุยกับพนักงานจริงได้ไหม"],
    turns: 3,
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
    customer:
      "You are a foreign customer living in Bangkok who wants to build a small house. " +
      "Write only in English, short chat-style messages.",
    opening: ["Hi, do you build houses in Bangkok?"],
    turns: 3,
  },
  {
    name: "ถามนอกขอบเขต",
    customer:
      "คุณเป็นลูกค้าที่ถามเรื่องนอกขอบเขตของบริษัท เช่น ขอคำแนะนำโครงสร้างว่าเสาเข็มควรลึกเท่าไหร่ " +
      "กฎหมายระยะร่นเท่าไหร่ และขอให้ช่วยเซ็นรับรองแบบ",
    opening: ["เสาเข็มบ้าน 2 ชั้นควรลึกกี่เมตรครับ"],
    turns: 3,
    expect: (s) =>
      s.replies.some((r) => r.needsHuman) ? [] : ["คำถามนอกขอบเขตแต่ไม่ส่งต่อทีมงาน"],
  },
];

function requireApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error("ต้องตั้ง GEMINI_API_KEY ก่อนรัน เช่น: GEMINI_API_KEY=xxx npm run test:chat");
    process.exit(2);
  }
  return key;
}

const client = new GoogleGenerativeAI(requireApiKey());

async function customerSays(scenario: Scenario, transcript: string[]): Promise<string> {
  const model = client.getGenerativeModel({
    model: process.env.GEMINI_MODEL ?? "gemini-3.5-flash",
    systemInstruction: `${scenario.customer}

คุณกำลังแชทกับ LINE OA ของบริษัทรับออกแบบและก่อสร้าง ตอบกลับเป็นข้อความแชทสั้น ๆ
เหมือนคนจริง 1-2 บรรทัด ห้ามอธิบายว่าคุณเป็น AI ห้ามใส่เครื่องหมายคำพูดครอบข้อความ
ตอบเฉพาะสิ่งที่ลูกค้าจะพิมพ์เท่านั้น`,
    generationConfig: { temperature: 0.9, maxOutputTokens: 200 },
  });

  const result = await model.generateContent(
    `บทสนทนาจนถึงตอนนี้:\n${transcript.join("\n")}\n\nลูกค้าจะพิมพ์อะไรต่อ`,
  );
  return result.response.text().trim();
}

function formatViolations(violations: Violation[]): string {
  return violations.map((v) => `      ${v.severity === "error" ? "❌" : "⚠️ "} [${v.rule}] ${v.detail}`).join("\n");
}

async function runScenario(scenario: Scenario): Promise<boolean> {
  console.log(`\n${"─".repeat(72)}\n▶ ${scenario.name}`);

  const history: ChatTurn[] = [];
  const transcript: string[] = [];
  const state: ConversationState = { replies: [], customerMessages: [] };
  let errors = 0;

  for (let turn = 0; turn < scenario.turns; turn++) {
    // The first turn uses the scripted opening, including its fragments merged
    // the way the inbox merges a burst of messages.
    const customerText =
      turn === 0 ? scenario.opening.join("\n") : await customerSays(scenario, transcript);

    for (const line of customerText.split("\n")) {
      if (line.trim()) console.log(`   👤 ${line.trim()}`);
    }
    transcript.push(`ลูกค้า: ${customerText}`);
    state.customerMessages.push(customerText);

    const ai = await generateChatReply({ history, userMessage: customerText });
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

async function main() {
  const filter = process.argv.slice(2).find((arg) => !arg.startsWith("-"));
  const scenarios = filter ? SCENARIOS.filter((s) => s.name.includes(filter)) : SCENARIOS;

  if (scenarios.length === 0) {
    console.error(`ไม่พบ scenario ที่ตรงกับ "${filter}"`);
    process.exit(2);
  }

  const results: Array<[string, boolean]> = [];
  for (const scenario of scenarios) {
    results.push([scenario.name, await runScenario(scenario)]);
  }

  console.log(`\n${"═".repeat(72)}\nสรุปผล`);
  for (const [name, passed] of results) console.log(`  ${passed ? "✅" : "❌"} ${name}`);

  const failed = results.filter(([, passed]) => !passed).length;
  console.log(`\n${results.length - failed}/${results.length} scenario ผ่าน`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
