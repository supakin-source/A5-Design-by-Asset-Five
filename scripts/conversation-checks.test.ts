import { test } from "node:test";
import assert from "node:assert/strict";
import { runAllChecks } from "../src/lib/conversation-checks";
import { normalizeBubbles, isQuotaError, resolveModels, MAX_BUBBLES, DEFAULT_MODEL } from "../src/lib/gemini";
import { isPureAcknowledgement, isAcknowledgementOnlyBatch } from "../src/lib/acknowledgement";

const rulesFor = (bubbles: string[], customerText: string) =>
  [...new Set(runAllChecks(bubbles, customerText).map((v) => v.rule))].sort();

test("a normal two-bubble reply passes", () => {
  assert.deepEqual(
    rulesFor(["รับทราบค่ะ ต่อเติมครัวนะคะ", "พื้นที่ประมาณกี่ตารางเมตรคะ"], "อยากต่อเติมครัว"),
    [],
  );
});

test("promising a callback time is caught, in Thai and English", () => {
  assert.deepEqual(rulesFor(["ทีมงานจะติดต่อกลับภายใน 1 วันทำการค่ะ"], "จะติดต่อกลับตอนไหน"), [
    "callback-promise",
  ]);
  assert.deepEqual(rulesFor(["Our team will call you within 2 hours."], "when will you call"), [
    "callback-promise",
  ]);
});

test("quoting a price is caught, but echoing the customer's own budget is not", () => {
  assert.deepEqual(rulesFor(["ราคาประมาณ 25,000 บาท ต่อตารางเมตรค่ะ"], "ตารางเมตรละเท่าไหร่"), [
    "price-quote",
  ]);
  assert.deepEqual(rulesFor(["งบ 3 ล้าน รับทราบค่ะ"], "งบผมราว 3 ล้าน"), []);
});

test("answering in the wrong language is caught", () => {
  assert.deepEqual(rulesFor(["สวัสดีค่ะ ยินดีให้บริการนะคะ"], "Hi, do you build houses?"), ["language"]);
  assert.deepEqual(rulesFor(["We will get back to you soon."], "สนใจสร้างบ้านค่ะ"), ["language"]);
});

test("a short reply without Thai characters is not a language switch", () => {
  assert.deepEqual(rulesFor(["OK 👌"], "ตกลงค่ะ"), []);
});

test("bubble count and length limits are enforced", () => {
  assert.deepEqual(rulesFor(["a", "b", "c", "d"], "hello there friend"), ["bubbles"]);
  assert.deepEqual(rulesFor(["ก".repeat(240)], "สวัสดี"), ["bubbles"]);
});

test("more than one emoji per answer is flagged", () => {
  assert.deepEqual(rulesFor(["สวัสดีค่ะ 😊🙏✨"], "สวัสดี"), ["emoji"]);
});

test("normalizeBubbles drops empties, caps the count, and splits long text at whitespace", () => {
  assert.deepEqual(normalizeBubbles(["ได้เลยค่ะ", "   ", ""]), ["ได้เลยค่ะ"]);
  assert.equal(normalizeBubbles(["a", "b", "c", "d", "e"]).length, MAX_BUBBLES);
  assert.deepEqual(normalizeBubbles([]), []);
  assert.deepEqual(normalizeBubbles("ไม่ได้เป็น array"), ["ไม่ได้เป็น array"]);

  const long = normalizeBubbles(["คำ ".repeat(200)]);
  assert.ok(long.length > 1, "ข้อความยาวต้องถูกหั่นเป็นหลายฟอง");
  assert.ok(
    long.every((bubble) => bubble.length <= 200),
    "ทุกฟองต้องไม่เกินลิมิต",
  );
  assert.ok(
    long.every((bubble) => !bubble.startsWith(" ") && !bubble.endsWith(" ")),
    "ฟองที่หั่นแล้วต้องไม่มีช่องว่างหัวท้าย",
  );
});

test("quota rejections are told apart from other failures", () => {
  const quotaMessage =
    "[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/" +
    "v1beta/models/gemini-3.5-flash:generateContent: [429 Too Many Requests] You exceeded your " +
    "current quota";
  assert.ok(isQuotaError(new Error(quotaMessage)), "429 ต้องถูกจับว่าเป็นโควตาหมด");
  assert.ok(isQuotaError(new Error("Quota exceeded for metric: generate_content_free_tier_requests")));
  assert.ok(!isQuotaError(new Error("[404 Not Found] models/gemini-9 is not found")));
  assert.ok(!isQuotaError(new Error("model returned no reply text")));
  assert.ok(!isQuotaError(new Error("fetch failed")));
});

test("closing remarks are recognised so the bot can stay silent", () => {
  for (const text of [
    "ขอบคุณครับ",
    "ขอบคุณค่ะ 🙏",
    "ขอบคุณมากนะคะ",
    "โอเคครับ",
    "ok",
    "Thanks!",
    "จ้า",
    "ครับผม",
    "รับทราบครับ",
    "เข้าใจแล้วค่ะ",
    "👍",
    "noted, thank you",
    "bye",
  ]) {
    assert.ok(isPureAcknowledgement(text), `ควรถือเป็นคำปิดบทสนทนา: "${text}"`);
  }
});

test("a closing word attached to a real request still gets an answer", () => {
  for (const text of [
    "ขอบคุณครับ แล้วราคาล่ะ",
    "ok แต่ขอถามอีกอย่าง",
    "ครับ ผมสนใจต่อเติมครัว",
    "โอเคไหมถ้าจะนัดดูหน้างาน",
    "thanks, can you call me tomorrow?",
    "เบอร์ผม 081-234-5678",
    "สวัสดีครับ",
  ]) {
    assert.ok(!isPureAcknowledgement(text), `ต้องไม่เงียบ: "${text}"`);
  }
});

test("a burst counts as closing only when every fragment is", () => {
  assert.ok(isAcknowledgementOnlyBatch(["ขอบคุณครับ", "👍"]));
  assert.ok(!isAcknowledgementOnlyBatch(["ขอบคุณครับ", "อ้อ แล้วต่อเติมครัวราคาเท่าไหร่"]));
  assert.ok(!isAcknowledgementOnlyBatch([]));
});

test("model selection treats a blank env var as unset, and runs one model by default", () => {
  const saved = { model: process.env.GEMINI_MODEL, fallback: process.env.GEMINI_FALLBACK_MODEL };
  try {
    delete process.env.GEMINI_MODEL;
    delete process.env.GEMINI_FALLBACK_MODEL;
    // One model by default: what is tested is exactly what customers get.
    assert.deepEqual(resolveModels(), { primary: DEFAULT_MODEL, fallback: null });

    // A CI input left empty arrives as "" and must not become the model id.
    process.env.GEMINI_MODEL = "";
    process.env.GEMINI_FALLBACK_MODEL = "   ";
    assert.deepEqual(resolveModels(), { primary: DEFAULT_MODEL, fallback: null });

    process.env.GEMINI_MODEL = " gemini-3.1-flash-lite ";
    assert.equal(resolveModels().primary, "gemini-3.1-flash-lite");

    // Cross-model failover is opt-in.
    process.env.GEMINI_FALLBACK_MODEL = "gemini-3.5-flash";
    assert.equal(resolveModels().fallback, "gemini-3.5-flash");

    // Words that mean "no second model", and a fallback equal to the primary,
    // both leave a single model rather than a pointless retry.
    for (const off of ["none", "OFF", "disabled", "false"]) {
      process.env.GEMINI_FALLBACK_MODEL = off;
      assert.equal(resolveModels().fallback, null, `"${off}" ต้องแปลว่าไม่มีรุ่นสำรอง`);
    }
    process.env.GEMINI_FALLBACK_MODEL = "gemini-3.1-flash-lite";
    assert.equal(resolveModels().fallback, null, "รุ่นสำรองเดียวกับรุ่นหลัก = ไม่มีรุ่นสำรอง");
  } finally {
    if (saved.model === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = saved.model;
    if (saved.fallback === undefined) delete process.env.GEMINI_FALLBACK_MODEL;
    else process.env.GEMINI_FALLBACK_MODEL = saved.fallback;
  }
});

test("templated purpose clauses are caught, using the real replies from the run", () => {
  // Every one of these was circled by the business in the first soak test.
  const scripted = [
    "เพื่อให้ทีมงานดูแลได้ตรงจุด ขออนุญาตเก็บข้อมูลเบื้องต้นนะคะ",
    "เพื่อให้ทีมงานประเมินเบื้องต้นได้แม่นยำขึ้น ไม่ทราบว่าพื้นที่อยู่ที่ไหนคะ",
    "เพื่อให้ทีมงานเตรียมข้อมูลได้ครบถ้วน รบกวนแจ้งเบอร์ติดต่อค่ะ",
    "To help me assist you better, could you tell me more about the project?",
  ];
  for (const reply of scripted) {
    const first = runAllChecks([reply], "สนใจต่อเติมครับ", { turnIndex: 0, previousReplies: [] });
    assert.ok(
      first.some((v) => v.rule === "scripted-phrasing"),
      `ควรถูกจับว่าเป็นวลีสำเร็จรูป: "${reply}"`,
    );
  }

  // Once is a warning; the same device again in the same conversation is an error.
  const repeated = runAllChecks(["เพื่อให้ทีมงานเตรียมข้อมูลได้ครบถ้วน รบกวนขอเบอร์ค่ะ"], "ได้ครับ", {
    turnIndex: 1,
    previousReplies: [["เพื่อให้ทีมงานดูแลได้ตรงจุด ขอถามรายละเอียดนะคะ"]],
  });
  assert.ok(repeated.some((v) => v.rule === "scripted-phrasing" && v.severity === "error"));

  // Asking directly is what we want and must stay clean.
  assert.deepEqual(
    rulesFor(["รับทราบค่ะ ต่อเติมครัวนะคะ", "พื้นที่ประมาณกี่ตารางเมตรคะ"], "อยากต่อเติมครัว"),
    [],
  );
});

test("repeating its own name after the introduction is caught", () => {
  // Introducing itself on the first turn is fine.
  assert.deepEqual(
    runAllChecks(["สวัสดีค่ะ Ady ผู้ช่วย AI ของ A5 Design ค่ะ"], "สวัสดี", {
      turnIndex: 0,
      previousReplies: [],
    }).filter((v) => v.rule === "self-name"),
    [],
  );

  const later = runAllChecks(["Ady ได้บันทึกเบอร์โทรไว้แล้วค่ะ"], "เบอร์ผม 081-234-5678", {
    turnIndex: 2,
    previousReplies: [["สวัสดีค่ะ"], ["รับทราบค่ะ"]],
  });
  assert.ok(later.some((v) => v.rule === "self-name" && v.severity === "warning"));

  const twice = runAllChecks(["Ady เข้าใจค่ะ", "Ady จะรีบประสานให้นะคะ"], "ช่วยด้วย", {
    turnIndex: 1,
    previousReplies: [["สวัสดีค่ะ"]],
  });
  assert.ok(twice.some((v) => v.rule === "self-name" && v.severity === "error"));
});
