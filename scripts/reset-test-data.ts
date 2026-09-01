/**
 * Wipes conversation data so the dashboard starts clean before real customers
 * arrive. Test traffic carries the old free-text categories ("inquiry_price",
 * "3 แสน") which would sit alongside the new fixed vocabularies and make the
 * charts read wrong.
 *
 *   npm run db:reset-test              # dry run — counts only, deletes nothing
 *   npm run db:reset-test -- --yes     # actually delete
 *   npm run db:reset-test -- --yes --before=2026-09-02   # only rows older than a date
 *
 * Leads, conversations, messages, staff notifications and the pending-message
 * queue all go together: a lead without its conversation is worse than no lead.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const confirmed = args.includes("--yes");
const beforeArg = args.find((a) => a.startsWith("--before="))?.split("=")[1];

function parseBefore(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    console.error(`ค่า --before ไม่ถูกต้อง: "${value}" (ตัวอย่าง: 2026-09-02 หรือ 2026-09-02T14:00:00+07:00)`);
    process.exit(2);
  }
  return date;
}

async function main() {
  const before = parseBefore(beforeArg);
  const leadWhere = before ? { createdAt: { lt: before } } : {};

  const leads = await prisma.lead.findMany({ where: leadWhere, select: { id: true } });
  const leadIds = leads.map((l) => l.id);

  const conversations = await prisma.conversation.findMany({
    where: { leadId: { in: leadIds } },
    select: { id: true, lead: { select: { lineUserId: true } } },
  });
  const conversationIds = conversations.map((c) => c.id);
  const lineUserIds = [...new Set(conversations.map((c) => c.lead.lineUserId))];

  const [messages, notifications, pending] = await Promise.all([
    prisma.message.count({ where: { conversationId: { in: conversationIds } } }),
    prisma.staffNotification.count({ where: { leadId: { in: leadIds } } }),
    prisma.pendingMessage.count({ where: { lineUserId: { in: lineUserIds } } }),
  ]);

  console.log(before ? `ขอบเขต: ข้อมูลที่สร้างก่อน ${before.toISOString()}` : "ขอบเขต: ข้อมูลทั้งหมด");
  console.log(`  ลูกค้า (Lead)            ${leads.length}`);
  console.log(`  บทสนทนา (Conversation)   ${conversations.length}`);
  console.log(`  ข้อความ (Message)        ${messages}`);
  console.log(`  แจ้งเตือนทีมงาน           ${notifications}`);
  console.log(`  คิวข้อความค้าง            ${pending}`);

  if (leads.length === 0) {
    console.log("\nไม่มีข้อมูลให้ลบ");
    return;
  }

  if (!confirmed) {
    console.log("\n(dry run) ยังไม่ได้ลบอะไร — เพิ่ม --yes เพื่อลบจริง");
    return;
  }

  // Children first: the schema has required relations back to the parents.
  await prisma.message.deleteMany({ where: { conversationId: { in: conversationIds } } });
  await prisma.conversation.deleteMany({ where: { id: { in: conversationIds } } });
  await prisma.staffNotification.deleteMany({ where: { leadId: { in: leadIds } } });
  await prisma.pendingMessage.deleteMany({ where: { lineUserId: { in: lineUserIds } } });
  await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });

  console.log("\nลบเรียบร้อย");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
