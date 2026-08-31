// Demo data for previewing the dashboard before real LINE traffic arrives.
// Run with: npm run db:seed   (safe to re-run; it clears demo rows first)
import { PrismaClient, LeadStatus, MessageRole } from "@prisma/client";

const prisma = new PrismaClient();

const DEMO_PREFIX = "Udemo-";

const leads = [
  { name: "คุณสมชาย (ตัวอย่าง)", phone: "08x-xxx-1234", projectType: "บ้านเดี่ยว 2 ชั้น", budgetRange: "5-7 ล้านบาท", location: "นนทบุรี", timeline: "ภายในปีนี้", status: LeadStatus.HANDED_OFF, topic: "ราคา", sentiment: "neutral" },
  { name: "คุณมาลี (ตัวอย่าง)", phone: "08x-xxx-5678", projectType: "รีโนเวทบ้าน", budgetRange: "1-3 ล้านบาท", location: "กรุงเทพฯ", timeline: "3-6 เดือน", status: LeadStatus.CONTACTED, topic: "แบบบ้าน", sentiment: "positive" },
  { name: "คุณวิชัย (ตัวอย่าง)", phone: "08x-xxx-9012", projectType: "อาคารพาณิชย์", budgetRange: "10 ล้านบาทขึ้นไป", location: "ชลบุรี", timeline: "ยังไม่กำหนด", status: LeadStatus.HANDED_OFF, topic: "ขั้นตอนการทำงาน", sentiment: "neutral" },
  { name: "คุณนภา (ตัวอย่าง)", phone: null, projectType: "ออกแบบอย่างเดียว", budgetRange: null, location: "กรุงเทพฯ", timeline: null, status: LeadStatus.NEW, topic: "ราคา", sentiment: "neutral" },
  { name: "คุณธนา (ตัวอย่าง)", phone: "08x-xxx-3456", projectType: "บ้านเดี่ยว 2 ชั้น", budgetRange: "5-7 ล้านบาท", location: "ปทุมธานี", timeline: "ภายในปีนี้", status: LeadStatus.HANDED_OFF, topic: "ระยะเวลาก่อสร้าง", sentiment: "positive" },
  { name: "คุณอรุณ (ตัวอย่าง)", phone: "08x-xxx-7890", projectType: "รีโนเวทบ้าน", budgetRange: "3-5 ล้านบาท", location: "กรุงเทพฯ", timeline: "1-3 เดือน", status: LeadStatus.CLOSED, topic: "ติดต่อทีมงาน", sentiment: "negative" },
  { name: "คุณกิตติ (ตัวอย่าง)", phone: "08x-xxx-2345", projectType: "บ้านเดี่ยวชั้นเดียว", budgetRange: "3-5 ล้านบาท", location: "เชียงใหม่", timeline: "ปีหน้า", status: LeadStatus.HANDED_OFF, topic: "พื้นที่ให้บริการ", sentiment: "neutral" },
  { name: "คุณศิริ (ตัวอย่าง)", phone: null, projectType: "บ้านเดี่ยว 2 ชั้น", budgetRange: null, location: "สมุทรปราการ", timeline: null, status: LeadStatus.NEW, topic: "แบบบ้าน", sentiment: "positive" },
];

async function main() {
  const demoLeads = await prisma.lead.findMany({ where: { lineUserId: { startsWith: DEMO_PREFIX } } });
  const demoLeadIds = demoLeads.map((l) => l.id);
  if (demoLeadIds.length > 0) {
    const convos = await prisma.conversation.findMany({ where: { leadId: { in: demoLeadIds } } });
    await prisma.message.deleteMany({ where: { conversationId: { in: convos.map((c) => c.id) } } });
    await prisma.conversation.deleteMany({ where: { leadId: { in: demoLeadIds } } });
    await prisma.staffNotification.deleteMany({ where: { leadId: { in: demoLeadIds } } });
    await prisma.lead.deleteMany({ where: { id: { in: demoLeadIds } } });
  }

  for (const [index, item] of leads.entries()) {
    const createdAt = new Date(Date.now() - index * 3 * 24 * 60 * 60 * 1000);
    const lead = await prisma.lead.create({
      data: {
        lineUserId: `${DEMO_PREFIX}${index + 1}`,
        displayName: item.name,
        phone: item.phone,
        projectType: item.projectType,
        budgetRange: item.budgetRange,
        location: item.location,
        timeline: item.timeline,
        status: item.status,
        consentShownAt: createdAt,
        createdAt,
      },
    });

    const conversation = await prisma.conversation.create({
      data: { leadId: lead.id, startedAt: createdAt, lastActive: createdAt },
    });

    await prisma.message.createMany({
      data: [
        {
          conversationId: conversation.id,
          role: MessageRole.USER,
          content: `สนใจ${item.projectType} ครับ/ค่ะ ขอรายละเอียดเพิ่มเติม`,
          topic: item.topic,
          sentiment: item.sentiment,
          createdAt,
        },
        {
          conversationId: conversation.id,
          role: MessageRole.BOT,
          content:
            "สวัสดีค่ะ ขอบคุณที่สนใจ A5 Design ค่ะ ดิฉันเป็นผู้ช่วย AI ขอรบกวนสอบถามรายละเอียดเบื้องต้นเพื่อให้ทีมงานติดต่อกลับนะคะ",
          createdAt: new Date(createdAt.getTime() + 30_000),
        },
      ],
    });

    if (item.status !== LeadStatus.NEW) {
      await prisma.staffNotification.create({
        data: {
          leadId: lead.id,
          channel: "line",
          status: "sent",
          message: `ตัวอย่างข้อความแจ้งเตือนทีมงานสำหรับ ${item.name}`,
          createdAt: new Date(createdAt.getTime() + 60_000),
        },
      });
    }
  }

  console.log(`Seeded ${leads.length} demo leads.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
