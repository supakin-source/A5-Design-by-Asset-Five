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
 *   GEMINI_API_KEY=... npm run test:chat -- --budget=6     # stop after 6 requests
 *   GEMINI_API_KEY=... npm run test:chat -- --gap=8000     # seconds between requests
 *
 * Quota matters: the bot side of every turn spends one Gemini request from the
 * same daily allowance production uses. Scripted turns are the default so a full
 * run costs one request per turn; --ai-customer doubles that in exchange for
 * less predictable, more realistic customers.
 *
 * LINE is not involved — this exercises the conversation, not the webhook.
 * Exit codes: 0 pass, 1 policy failures or an AI error, 2 bad usage,
 * 3 quota exhausted or the --budget ceiling reached.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  generateChatReply,
  resolveModels,
  isQuotaError,
  geminiRequestsMade,
  type ChatTurn,
  type StructuredChatReply,
} from "../src/lib/gemini";
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

// Customer-simulator calls happen here; bot-side calls (including fallback
// retries) are counted inside the library.
let simulatorCalls = 0;
const totalRequests = () => simulatorCalls + geminiRequestsMade();

// Optional ceiling so a run cannot eat the live bot's daily allowance.
const budgetArg = args.find((a) => a.startsWith("--budget="));
const budget = budgetArg ? Number(budgetArg.split("=")[1]) : Infinity;

// Free tiers cap requests per minute as well as per day, and a scripted run
// fires far faster than a real conversation would. Pacing keeps a run from
// tripping the per-minute limit while its daily allowance is still intact.
//
// gemini-3.1-flash-lite is documented at 15 requests/minute, so 5s between
// requests (12/min) leaves headroom for the retry a refusal triggers.
const DEFAULT_GAP_MS = 5000;
const gapArg = args.find((a) => a.startsWith("--gap="));

// Soak mode: keep cycling the scenarios for this long, spreading requests out.
// Repetition is the point — it catches a model that follows the policy on one
// run and breaks it on the next.
const durationArg = args.find((a) => a.startsWith("--duration="));
const durationMs = durationArg ? parseDuration(durationArg.split("=")[1]) : 0;

function parseDuration(value: string): number {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(h|m|s)?$/i);
  if (!match) {
    console.error(`ค่า --duration ไม่ถูกต้อง: "${value}" (ตัวอย่าง: 2h, 90m, 3600s)`);
    process.exit(2);
  }
  const amount = Number(match[1]);
  const unit = (match[2] ?? "m").toLowerCase();
  return amount * (unit === "h" ? 3_600_000 : unit === "s" ? 1_000 : 60_000);
}

// With a duration and a budget, spread the budget evenly across the window so
// the run ends on time and never bunches requests up against the per-minute cap.
const GAP_MS = gapArg
  ? Number(gapArg.split("=")[1])
  : durationMs && Number.isFinite(budget)
    ? Math.max(DEFAULT_GAP_MS, Math.floor(durationMs / budget))
    : DEFAULT_GAP_MS;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let lastRequestAt = 0;

async function pace() {
  const waitFor = lastRequestAt + GAP_MS - Date.now();
  if (waitFor > 0) await sleep(waitFor);
  lastRequestAt = Date.now();
}

function retryDelayMs(retryAfter?: string): number {
  const seconds = retryAfter ? Number.parseFloat(retryAfter) : NaN;
  // A per-minute limit clears within the minute; cap the wait so a genuinely
  // spent daily quota does not stall the run.
  return Number.isFinite(seconds) ? Math.min(Math.max(seconds, 1) * 1000 + 1000, 70_000) : 30_000;
}

function requireApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error("ต้องตั้ง GEMINI_API_KEY ก่อนรัน เช่น: GEMINI_API_KEY=xxx npm run test:chat");
    process.exit(2);
  }
  return key;
}

const client = new GoogleGenerativeAI(requireApiKey());

class BudgetReached extends Error {
  constructor(readonly used: number) {
    super("request budget reached");
  }
}

class QuotaExhausted extends Error {
  constructor(readonly retryAfter?: string) {
    super("gemini quota exhausted");
  }
}

function asQuotaError(err: unknown): QuotaExhausted | null {
  const message = err instanceof Error ? err.message : String(err);
  if (!isQuotaError(message)) return null;
  const retry = message.match(/retry in ([\d.]+s)/i)?.[1] ?? message.match(/"retryDelay":\s*"([^"]+)"/)?.[1];
  return new QuotaExhausted(retry);
}

async function customerSays(scenario: Scenario, transcript: string[]): Promise<string> {
  const model = client.getGenerativeModel({
    model: resolveModels().primary,
    systemInstruction: `${scenario.customer}

คุณกำลังแชทกับ LINE OA ของบริษัทรับออกแบบและก่อสร้าง ตอบกลับเป็นข้อความแชทสั้น ๆ
เหมือนคนจริง 1-2 บรรทัด ห้ามอธิบายว่าคุณเป็น AI ห้ามใส่เครื่องหมายคำพูดครอบข้อความ
ตอบเฉพาะสิ่งที่ลูกค้าจะพิมพ์เท่านั้น`,
    generationConfig: { temperature: 0.9, maxOutputTokens: 200 },
  });

  await pace();
  simulatorCalls++;
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

interface ScenarioResult {
  passed: boolean;
  rules: string[];
}

async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
  console.log(`\n${"─".repeat(72)}\n▶ ${scenario.name}`);

  const history: ChatTurn[] = [];
  const transcript: string[] = [];
  const state: ConversationState = { replies: [], customerMessages: [] };
  const rules: string[] = [];
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

    if (totalRequests() >= budget) {
      throw new BudgetReached(totalRequests());
    }

    await pace();
    let ai = await generateChatReply({ history, userMessage: customerText });

    // generateChatReply swallows API errors by design (production must never
    // leave a customer unanswered), but in a test that silence would look like
    // a passing run. Re-raise it, keeping the real reason so a spent quota is
    // not confused with a wrong model id.
    if (ai.escalationReason === "ai_unavailable") {
      const reason = ai.failure ?? "ไม่ทราบสาเหตุ";
      if (!isQuotaError(reason)) throw new Error(`เรียก AI ไม่สำเร็จ: ${reason}`);

      // A per-minute limit clears on its own, so wait it out once before
      // concluding the daily allowance is gone.
      const quota = asQuotaError(reason) ?? new QuotaExhausted();
      const waitMs = retryDelayMs(quota.retryAfter);
      console.log(`      ⏳ โดนจำกัดอัตราการเรียก รอ ${Math.round(waitMs / 1000)} วินาทีแล้วลองใหม่`);
      await sleep(waitMs);
      lastRequestAt = Date.now();
      ai = await generateChatReply({ history, userMessage: customerText });
      if (ai.escalationReason === "ai_unavailable") {
        const retryReason = ai.failure ?? "ไม่ทราบสาเหตุ";
        if (!isQuotaError(retryReason)) throw new Error(`เรียก AI ไม่สำเร็จ: ${retryReason}`);
        throw asQuotaError(retryReason) ?? new QuotaExhausted();
      }
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
      rules.push(...violations.filter((v) => v.severity === "error").map((v) => v.rule));
    }

    history.push({ role: "user", text: customerText });
    history.push({ role: "model", text: ai.replies.join("\n") });
    transcript.push(`บอท: ${ai.replies.join(" ")}`);
  }

  const expectationFailures = scenario.expect?.(state) ?? [];
  for (const failure of expectationFailures) console.log(`      ❌ [expect] ${failure}`);
  errors += expectationFailures.length;
  rules.push(...expectationFailures.map(() => "expect"));

  console.log(errors === 0 ? "   ✅ ผ่าน" : `   ❌ ไม่ผ่าน (${errors} ข้อ)`);
  return { passed: errors === 0, rules };
}

// Anything that is not a spent quota: usually a model id this key cannot use.
function reportAiFailure(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  const { primary, fallback } = resolveModels();
  console.error(`\n${"═".repeat(72)}`);
  console.error("⛔ เรียก AI ไม่สำเร็จ (ไม่ใช่เรื่องโควตา)");
  console.error(`   โมเดลที่ใช้: ${primary} · สำรอง: ${fallback}`);
  console.error(`   ${message}`);
  if (/404|not found|unsupported|permission/i.test(message)) {
    console.error("");
    console.error("   น่าจะเป็นเพราะชื่อรุ่นไม่ถูกต้อง หรือ key นี้ยังไม่มีสิทธิ์ใช้รุ่นนี้");
    console.error("   ดูรายชื่อรุ่นที่ key ใช้ได้จริง:");
    console.error("   https://generativelanguage.googleapis.com/v1beta/models?key=<GEMINI_API_KEY>");
  }
}

function reportQuotaExhausted(quota: QuotaExhausted, done: number, total: number) {
  console.error(`\n${"═".repeat(72)}`);
  console.error("⛔ โควตา Gemini หมด — หยุดการทดสอบ");
  console.error(`   รันไปแล้ว ${done}/${total} scenario · ใช้ไป ${totalRequests()} request`);
  if (quota.retryAfter) console.error(`   ลองใหม่ได้ในอีก ${quota.retryAfter}`);
  console.error("");
  console.error("   (ลองใหม่หลังรอแล้วหนึ่งครั้ง ยังไม่ผ่าน จึงน่าจะเป็นโควตารายวันจริง)");
  console.error("");
  console.error("   ทางเลือก:");
  console.error("   1. รันทีละ scenario:  npm run test:chat -- <ชื่อบางส่วน>");
  console.error("   2. เปลี่ยน GEMINI_MODEL เป็นรุ่นที่โควตาฟรีมากกว่า");
  console.error("   3. เปิด billing ที่ Google AI Studio (จ่ายตามใช้จริง)");
  console.error("");
  console.error("   ⚠️  โควตานี้เป็นก้อนเดียวกับที่บอทตัวจริงใช้ — ถ้าเทสต์จนหมด");
  console.error("       บอทจะตอบข้อความสำรองให้ลูกค้าจนกว่าโควตาจะรีเซ็ต");
}

interface Tally {
  runs: number;
  passes: number;
  rules: Map<string, number>;
}

function printSummary(tally: Map<string, Tally>, startedAt: number, rounds: number) {
  const elapsedMin = Math.round((Date.now() - startedAt) / 60_000);
  console.log(`\n${"═".repeat(72)}`);
  console.log(`สรุปผล · ${rounds} รอบ · ${elapsedMin} นาที · ใช้ไป ${totalRequests()} Gemini request`);
  console.log(`โมเดล: ${resolveModels().primary}\n`);

  for (const [name, t] of tally) {
    const rate = t.runs ? Math.round((t.passes / t.runs) * 100) : 0;
    const mark = t.passes === t.runs ? "✅" : t.passes === 0 ? "❌" : "⚠️ ";
    console.log(`  ${mark} ${name} — ผ่าน ${t.passes}/${t.runs} (${rate}%)`);
    for (const [rule, count] of [...t.rules].sort((a, b) => b[1] - a[1])) {
      console.log(`        ผิดกฎ [${rule}] ${count} ครั้ง`);
    }
  }

  const totals = [...tally.values()].reduce(
    (acc, t) => ({ runs: acc.runs + t.runs, passes: acc.passes + t.passes }),
    { runs: 0, passes: 0 },
  );
  console.log(`\nรวม ${totals.passes}/${totals.runs} รอบผ่าน`);
  return totals;
}

async function main() {
  const scenarios = filter ? SCENARIOS.filter((s) => s.name.includes(filter)) : SCENARIOS;

  if (scenarios.length === 0) {
    console.error(`ไม่พบ scenario ที่ตรงกับ "${filter}"`);
    console.error(`มีให้เลือก: ${SCENARIOS.map((s) => s.name).join(", ")}`);
    process.exit(2);
  }

  const turnCount = scenarios.reduce((sum, s) => sum + s.script.length, 0);
  const perRound = useAiCustomer ? turnCount * 2 - scenarios.length : turnCount;
  const { primary, fallback } = resolveModels();

  console.log(`โมเดลที่ทดสอบ: ${primary}${fallback ? ` (สำรอง: ${fallback})` : " (ไม่มีรุ่นสำรอง)"}`);
  console.log(
    `จะรัน ${scenarios.length} scenario · ${perRound} request ต่อรอบ · เว้นจังหวะ ${GAP_MS / 1000} วิ` +
      (Number.isFinite(budget) ? ` · เพดาน ${budget} request` : ""),
  );
  if (durationMs) {
    const rounds = Math.floor(durationMs / (perRound * GAP_MS));
    const planned = rounds * perRound;
    console.log(
      `โหมดรันยาว ${Math.round(durationMs / 60_000)} นาที · คาดว่าจะได้ประมาณ ${rounds} รอบ ` +
        `(~${planned} request)`,
    );
    if (!Number.isFinite(budget) && planned > 200) {
      console.log(
        `⚠️  ยังไม่ได้ตั้ง --budget และแผนนี้จะใช้ ~${planned} request ซึ่งน่าจะเกินโควตาฟรีรายวัน\n` +
          `   ใส่ --budget=<จำนวน> เพื่อให้สคริปต์กระจายจังหวะเองและหยุดตรงเพดาน`,
      );
    }
  }

  const startedAt = Date.now();
  const deadline = durationMs ? startedAt + durationMs : 0;
  const tally = new Map<string, Tally>(
    scenarios.map((s) => [s.name, { runs: 0, passes: 0, rules: new Map<string, number>() }]),
  );
  let rounds = 0;

  try {
    do {
      rounds++;
      if (durationMs) console.log(`\n${"█".repeat(72)}\nรอบที่ ${rounds}`);

      for (const scenario of scenarios) {
        if (deadline && Date.now() >= deadline) break;
        const result = await runScenario(scenario);
        const t = tally.get(scenario.name)!;
        t.runs++;
        if (result.passed) t.passes++;
        for (const rule of result.rules) t.rules.set(rule, (t.rules.get(rule) ?? 0) + 1);
      }
    } while (deadline && Date.now() < deadline && totalRequests() < budget);
  } catch (err) {
    if (err instanceof BudgetReached) {
      console.error(`\n⛔ ถึงเพดาน --budget ที่ตั้งไว้ (ใช้ไป ${err.used} request) หยุดก่อนโควตาจริงจะหมด`);
      printSummary(tally, startedAt, rounds);
      process.exit(3);
    }
    const quota = err instanceof QuotaExhausted ? err : asQuotaError(err);
    if (quota) {
      reportQuotaExhausted(quota, rounds, rounds);
      printSummary(tally, startedAt, rounds);
      process.exit(3);
    }
    reportAiFailure(err);
    printSummary(tally, startedAt, rounds);
    process.exit(1);
  }

  const totals = printSummary(tally, startedAt, rounds);
  process.exit(totals.passes === totals.runs ? 0 : 1);
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
