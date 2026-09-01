import { test } from "node:test";
import assert from "node:assert/strict";
import { runAllChecks } from "../src/lib/conversation-checks";
import { normalizeBubbles, MAX_BUBBLES } from "../src/lib/gemini";

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
    long.every((bubble) => bubble.length <= 220),
    "ทุกฟองต้องไม่เกินลิมิต",
  );
  assert.ok(
    long.every((bubble) => !bubble.startsWith(" ") && !bubble.endsWith(" ")),
    "ฟองที่หั่นแล้วต้องไม่มีช่องว่างหัวท้าย",
  );
});
