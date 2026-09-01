// Demo data for previewing the dashboard before real LINE traffic arrives.
// Run with: npm run db:seed   (safe to re-run; it clears demo rows first)
import { PrismaClient, ProjectStatus, MessageRole } from "@prisma/client";

const prisma = new PrismaClient();

const DEMO_PREFIX = "Udemo-";

const projects = [
  { name: "คุณสมชาย (ตัวอย่าง)", phone: "08x-xxx-1234", projectType: "บ้านเดี่ยว 2 ชั้น", budgetRange: "5-7 ล้านบาท", location: "นนทบุรี", timeline: "ภายในปีนี้", status: ProjectStatus.HANDED_OFF, topic: "ราคา", sentiment: "neutral" },
  { name: "คุณมาลี (ตัวอย่าง)", phone: "08x-xxx-5678", projectType: "รีโนเวทบ้าน", budgetRange: "1-3 ล้านบาท", location: "กรุงเทพฯ", timeline: "3-6 เดือน", status: ProjectStatus.CONTACTED, topic: "แบบบ้าน", sentiment: "positive" },
  { name: "คุณวิชัย (ตัวอย่าง)", phone: "08x-xxx-9012", projectType: "อาคารพาณิชย์", budgetRange: "10 ล้านบาทขึ้นไป", location: "ชลบุรี", timeline: "ยังไม่กำหนด", status: ProjectStatus.HANDED_OFF, topic: "ขั้นตอนการทำงาน", sentiment: "neutral" },
  { name: "คุณนภา (ตัวอย่าง)", phone: null, projectType: "ออกแบบอย่างเดียว", budgetRange: null, location: "กรุงเทพฯ", timeline: null, status: ProjectStatus.NEW, topic: "ราคา", sentiment: "neutral" },
  { name: "คุณธนา (ตัวอย่าง)", phone: "08x-xxx-3456", projectType: "บ้านเดี่ยว 2 ชั้น", budgetRange: "5-7 ล้านบาท", location: "ปทุมธานี", timeline: "ภายในปีนี้", status: ProjectStatus.HANDED_OFF, topic: "ระยะเวลาก่อสร้าง", sentiment: "positive" },
  { name: "คุณอรุณ (ตัวอย่าง)", phone: "08x-xxx-7890", projectType: "รีโนเวทบ้าน", budgetRange: "3-5 ล้านบาท", location: "กรุงเทพฯ", timeline: "1-3 เดือน", status: ProjectStatus.CLOSED, topic: "ติดต่อทีมงาน", sentiment: "negative" },
  { name: "คุณกิตติ (ตัวอย่าง)", phone: "08x-xxx-2345", projectType: "บ้านเดี่ยวชั้นเดียว", budgetRange: "3-5 ล้านบาท", location: "เชียงใหม่", timeline: "ปีหน้า", status: ProjectStatus.HANDED_OFF, topic: "พื้นที่ให้บริการ", sentiment: "neutral" },
  { name: "คุณศิริ (ตัวอย่าง)", phone: null, projectType: "บ้านเดี่ยว 2 ชั้น", budgetRange: null, location: "สมุทรปราการ", timeline: null, status: ProjectStatus.NEW, topic: "แบบบ้าน", sentiment: "positive" },
  // A repeat customer: two settled projects, illustrating that a returning
  // customer's new inquiry gets its own row instead of overwriting the old one.
  { name: "คุณปิยะ (ตัวอย่าง — ลูกค้าเดิม)", phone: "08x-xxx-6789", projectType: "ต่อเติม", budgetRange: "ต่ำกว่า 5 แสน", location: "กรุงเทพฯ", timeline: "ปีที่แล้ว", status: ProjectStatus.CLOSED, topic: "ต่อเติม/รีโนเวท", sentiment: "positive", reuseLineUserId: true },
  { name: "คุณปิยะ (ตัวอย่าง — ลูกค้าเดิม)", phone: "08x-xxx-6789", projectType: "รีโนเวท", budgetRange: "1-3 ล้าน", location: "กรุงเทพฯ", timeline: "ปีนี้", status: ProjectStatus.NEW, topic: "ต่อเติม/รีโนเวท", sentiment: "positive", reuseLineUserId: true },
];

async function main() {
  const demoLeads = await prisma.lead.findMany({ where: { lineUserId: { startsWith: DEMO_PREFIX } } });
  const demoLeadIds = demoLeads.map((l) => l.id);
  if (demoLeadIds.length > 0) {
    const demoProjects = await prisma.project.findMany({ where: { leadId: { in: demoLeadIds } } });
    const demoProjectIds = demoProjects.map((p) => p.id);
    const convos = await prisma.conversation.findMany({ where: { projectId: { in: demoProjectIds } } });
    await prisma.message.deleteMany({ where: { conversationId: { in: convos.map((c) => c.id) } } });
    await prisma.conversation.deleteMany({ where: { projectId: { in: demoProjectIds } } });
    await prisma.staffNotification.deleteMany({ where: { projectId: { in: demoProjectIds } } });
    await prisma.project.deleteMany({ where: { id: { in: demoProjectIds } } });
    await prisma.lead.deleteMany({ where: { id: { in: demoLeadIds } } });
  }

  // The repeat-customer pair above shares one lineUserId, so the two Project
  // rows land under the same Lead — track that here instead of a fresh
  // lineUserId per row.
  let repeatLineUserId: string | null = null;

  for (const [index, item] of projects.entries()) {
    const createdAt = new Date(Date.now() - index * 3 * 24 * 60 * 60 * 1000);
    const lineUserId: string = item.reuseLineUserId
      ? repeatLineUserId ?? `${DEMO_PREFIX}repeat`
      : `${DEMO_PREFIX}${index + 1}`;
    if (item.reuseLineUserId) repeatLineUserId = lineUserId;

    const lead = await prisma.lead.upsert({
      where: { lineUserId },
      update: { displayName: item.name },
      create: { lineUserId, displayName: item.name, consentShownAt: createdAt, createdAt },
    });

    const project = await prisma.project.create({
      data: {
        leadId: lead.id,
        phone: item.phone,
        projectType: item.projectType,
        budgetRange: item.budgetRange,
        location: item.location,
        timeline: item.timeline,
        status: item.status,
        createdAt,
        updatedAt: createdAt,
      },
    });

    const conversation = await prisma.conversation.create({
      data: { projectId: project.id, startedAt: createdAt, lastActive: createdAt },
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

    if (item.status !== ProjectStatus.NEW) {
      await prisma.staffNotification.create({
        data: {
          projectId: project.id,
          channel: "line",
          status: "sent",
          message: `ตัวอย่างข้อความแจ้งเตือนทีมงานสำหรับ ${item.name}`,
          createdAt: new Date(createdAt.getTime() + 60_000),
        },
      });
    }
  }

  console.log(`Seeded ${projects.length} demo projects.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
