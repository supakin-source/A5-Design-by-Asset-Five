/**
 * Merges duplicate Project rows created for the same real service request —
 * e.g. from the mid-conversation fragmentation bug (see docs/AI_POLICY.md
 * §1.2a): once fixed, this cleans up any Project rows it already created
 * before the fix shipped.
 *
 *   npx tsx scripts/merge-duplicate-projects.ts <primaryProjectId> <duplicateProjectId...>
 *   npx tsx scripts/merge-duplicate-projects.ts <primaryProjectId> <duplicateProjectId...> --yes
 *
 * Everything from each duplicate (conversations, messages, staff
 * notifications) moves onto the primary project; any field the primary is
 * missing gets filled in from the first duplicate that has it. The duplicate
 * Project rows are deleted once empty. Both projects must belong to the same
 * Lead — refuses to merge across customers.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const confirmed = process.argv.includes("--yes");
const [primaryId, ...duplicateIds] = args;

const FIELD_KEYS = [
  "phone",
  "projectType",
  "projectDetail",
  "budgetRange",
  "location",
  "timeline",
  "contactNote",
  "notes",
] as const;

async function main() {
  if (!primaryId || duplicateIds.length === 0) {
    console.error("ใช้งาน: npx tsx scripts/merge-duplicate-projects.ts <primaryProjectId> <duplicateProjectId...> [--yes]");
    process.exit(2);
  }

  const primary = await prisma.project.findUnique({ where: { id: primaryId } });
  if (!primary) {
    console.error(`ไม่พบ Project id: ${primaryId}`);
    process.exit(2);
  }

  const duplicates = await prisma.project.findMany({ where: { id: { in: duplicateIds } } });
  const missing = duplicateIds.filter((id) => !duplicates.some((d) => d.id === id));
  if (missing.length > 0) {
    console.error(`ไม่พบ Project id: ${missing.join(", ")}`);
    process.exit(2);
  }
  const wrongLead = duplicates.filter((d) => d.leadId !== primary.leadId);
  if (wrongLead.length > 0) {
    console.error(
      `Project ${wrongLead.map((d) => d.id).join(", ")} เป็นของลูกค้าคนละคนกับ ${primaryId} — ปฏิเสธการ merge`,
    );
    process.exit(2);
  }

  console.log(`หลัก: ${primary.id} (${primary.projectType ?? "ไม่ระบุประเภทงาน"})`);
  for (const d of duplicates) {
    console.log(`  จะ merge เข้ามา: ${d.id} (${d.projectType ?? "ไม่ระบุประเภทงาน"})`);
  }

  const fill: Record<string, string> = {};
  for (const key of FIELD_KEYS) {
    if (primary[key]) continue;
    const source = duplicates.find((d) => d[key]);
    if (source) fill[key] = source[key] as string;
  }
  if (Object.keys(fill).length > 0) {
    console.log("จะเติมข้อมูลที่ primary ยังไม่มี:", fill);
  }

  const conversations = await prisma.conversation.count({ where: { projectId: { in: duplicateIds } } });
  const notifications = await prisma.staffNotification.count({ where: { projectId: { in: duplicateIds } } });
  console.log(`จะย้าย: บทสนทนา ${conversations} รายการ, การแจ้งเตือนทีมงาน ${notifications} รายการ`);

  if (!confirmed) {
    console.log("\n(dry run) ยังไม่ได้ merge — เพิ่ม --yes เพื่อทำจริง");
    return;
  }

  await prisma.$transaction([
    ...(Object.keys(fill).length > 0 ? [prisma.project.update({ where: { id: primaryId }, data: fill })] : []),
    prisma.conversation.updateMany({ where: { projectId: { in: duplicateIds } }, data: { projectId: primaryId } }),
    prisma.staffNotification.updateMany({
      where: { projectId: { in: duplicateIds } },
      data: { projectId: primaryId },
    }),
    prisma.project.deleteMany({ where: { id: { in: duplicateIds } } }),
  ]);

  console.log("\nmerge เรียบร้อย");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
