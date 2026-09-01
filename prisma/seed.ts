// Demo data for previewing the dashboard before real LINE traffic arrives.
// Run with: npm run db:seed   (safe to re-run; it clears demo rows first)
import { PrismaClient, ProjectStatus, MessageRole } from "@prisma/client";
import { PROJECT_TYPES, BUDGET_BANDS, TOPICS } from "../src/lib/policy";

const prisma = new PrismaClient();

const DEMO_PREFIX = "Udemo-";

// Thai local hours the demo conversations start at — the evening peak people
// actually message an OA in, plus a couple of lunchtime ones.
const DEMO_HOURS = [20, 21, 12, 19, 20, 13, 22, 20, 19, 21];

// Demo rows use the same fixed vocabularies the bot is constrained to (see
// src/lib/policy.ts) rather than free text, so the preview shows the charts
// grouping cleanly — which is the whole point of those vocabularies.
const [NEW_BUILD, EXTENSION, RENOVATE, COMMERCIAL, DESIGN_ONLY] = PROJECT_TYPES;
const [UNDER_500K, HALF_TO_1M, ONE_TO_3M, THREE_TO_5M, FIVE_TO_10M, OVER_10M] = BUDGET_BANDS;
const [TOPIC_PRICE, TOPIC_DESIGN, , TOPIC_RENOVATE, , TOPIC_PROCESS, TOPIC_AREA, TOPIC_CALLBACK] = TOPICS;

const projects = [
  { name: "คุณสมชาย (ตัวอย่าง)", phone: "08x-xxx-1234", projectType: NEW_BUILD, budgetRange: FIVE_TO_10M, location: "นนทบุรี", timeline: "ภายในปีนี้", status: ProjectStatus.HANDED_OFF, topic: TOPIC_PRICE, sentiment: "neutral" },
  { name: "คุณมาลี (ตัวอย่าง)", phone: "08x-xxx-5678", projectType: RENOVATE, budgetRange: ONE_TO_3M, location: "กรุงเทพฯ", timeline: "3-6 เดือน", status: ProjectStatus.CONTACTED, topic: TOPIC_DESIGN, sentiment: "positive" },
  { name: "คุณวิชัย (ตัวอย่าง)", phone: "08x-xxx-9012", projectType: COMMERCIAL, budgetRange: OVER_10M, location: "ชลบุรี", timeline: "ยังไม่กำหนด", status: ProjectStatus.HANDED_OFF, topic: TOPIC_PROCESS, sentiment: "neutral" },
  { name: "คุณนภา (ตัวอย่าง)", phone: null, projectType: DESIGN_ONLY, budgetRange: null, location: "กรุงเทพฯ", timeline: null, status: ProjectStatus.NEW, topic: TOPIC_PRICE, sentiment: "neutral" },
  { name: "คุณธนา (ตัวอย่าง)", phone: "08x-xxx-3456", projectType: NEW_BUILD, budgetRange: FIVE_TO_10M, location: "ปทุมธานี", timeline: "ภายในปีนี้", status: ProjectStatus.HANDED_OFF, topic: TOPIC_PROCESS, sentiment: "positive" },
  { name: "คุณอรุณ (ตัวอย่าง)", phone: "08x-xxx-7890", projectType: RENOVATE, budgetRange: THREE_TO_5M, location: "กรุงเทพฯ", timeline: "1-3 เดือน", status: ProjectStatus.CLOSED, topic: TOPIC_CALLBACK, sentiment: "negative" },
  { name: "คุณกิตติ (ตัวอย่าง)", phone: "08x-xxx-2345", projectType: NEW_BUILD, budgetRange: THREE_TO_5M, location: "เชียงใหม่", timeline: "ปีหน้า", status: ProjectStatus.HANDED_OFF, topic: TOPIC_AREA, sentiment: "neutral" },
  { name: "คุณศิริ (ตัวอย่าง)", phone: null, projectType: NEW_BUILD, budgetRange: HALF_TO_1M, location: "สมุทรปราการ", timeline: null, status: ProjectStatus.NEW, topic: TOPIC_DESIGN, sentiment: "positive" },
  // A repeat customer: two settled projects, illustrating that a returning
  // customer's new inquiry gets its own row instead of overwriting the old one.
  { name: "คุณปิยะ (ตัวอย่าง — ลูกค้าเดิม)", phone: "08x-xxx-6789", projectType: EXTENSION, budgetRange: UNDER_500K, location: "กรุงเทพฯ", timeline: "ปีที่แล้ว", status: ProjectStatus.CLOSED, topic: TOPIC_RENOVATE, sentiment: "positive", reuseLineUserId: true },
  { name: "คุณปิยะ (ตัวอย่าง — ลูกค้าเดิม)", phone: "08x-xxx-6789", projectType: RENOVATE, budgetRange: ONE_TO_3M, location: "กรุงเทพฯ", timeline: "ปีนี้", status: ProjectStatus.NEW, topic: TOPIC_RENOVATE, sentiment: "positive", reuseLineUserId: true },
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
    // Spread the demo traffic over evening/lunchtime hours (Thai time) rather
    // than all landing on the same minute, so the hour-of-day chart on the
    // market-data page shows a believable shape while previewing.
    const hourOfDay = DEMO_HOURS[index % DEMO_HOURS.length];
    const createdAt = new Date(Date.now() - index * 3 * 24 * 60 * 60 * 1000);
    createdAt.setUTCHours(hourOfDay - 7, (index * 17) % 60, 0, 0); // UTC+7 → Thai local
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
