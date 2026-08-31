import { MessageRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { CategoryBarChart, DailyLineChart, type CategoryDatum } from "@/components/charts";

export const dynamic = "force-dynamic";

const MAX_CATEGORIES = 10;
const DAYS = 30;

// Keeps charts readable: the long tail folds into one "อื่น ๆ" bar instead of
// becoming dozens of one-off rows.
function foldTail(data: CategoryDatum[]): CategoryDatum[] {
  const sorted = [...data].sort((a, b) => b.value - a.value);
  if (sorted.length <= MAX_CATEGORIES) return sorted;
  const head = sorted.slice(0, MAX_CATEGORIES - 1);
  const tailTotal = sorted.slice(MAX_CATEGORIES - 1).reduce((sum, d) => sum + d.value, 0);
  return [...head, { label: "อื่น ๆ", value: tailTotal }];
}

async function leadFieldDistribution(field: "projectType" | "budgetRange" | "location"): Promise<CategoryDatum[]> {
  const rows = await prisma.lead.groupBy({
    by: [field],
    _count: { _all: true },
    where: { [field]: { not: null } },
  });
  return foldTail(rows.map((r) => ({ label: r[field] ?? "(ไม่ระบุ)", value: r._count._all })));
}

const SENTIMENT_META: Array<{ key: string; label: string; color: string; icon: string }> = [
  { key: "positive", label: "เชิงบวก", color: "var(--status-good)", icon: "▲" },
  { key: "neutral", label: "กลาง", color: "var(--text-muted)", icon: "■" },
  { key: "negative", label: "เชิงลบ", color: "var(--status-critical)", icon: "▼" },
];

export default async function AnalyticsPage() {
  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);

  const [projectTypes, budgets, locations, topicRows, sentimentRows, recentLeads] = await Promise.all([
    leadFieldDistribution("projectType"),
    leadFieldDistribution("budgetRange"),
    leadFieldDistribution("location"),
    prisma.message.groupBy({
      by: ["topic"],
      _count: { _all: true },
      where: { topic: { not: null }, role: MessageRole.USER },
    }),
    prisma.message.groupBy({
      by: ["sentiment"],
      _count: { _all: true },
      where: { sentiment: { not: null }, role: MessageRole.USER },
    }),
    prisma.lead.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
  ]);

  const topics = foldTail(topicRows.map((r) => ({ label: r.topic ?? "(ไม่ระบุ)", value: r._count._all })));

  const sentimentTotal = sentimentRows.reduce((sum, r) => sum + r._count._all, 0);
  const sentimentCounts = new Map(sentimentRows.map((r) => [r.sentiment, r._count._all]));

  const dailyCounts = new Map<string, number>();
  for (let i = DAYS - 1; i >= 0; i--) {
    const day = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    dailyCounts.set(day.toISOString().slice(5, 10), 0);
  }
  for (const lead of recentLeads) {
    const key = lead.createdAt.toISOString().slice(5, 10);
    if (dailyCounts.has(key)) dailyCounts.set(key, (dailyCounts.get(key) ?? 0) + 1);
  }
  const daily = [...dailyCounts.entries()].map(([date, value]) => ({ date, value }));

  return (
    <>
      <h1 style={{ fontSize: 20, marginTop: 0 }}>Market data</h1>
      <p style={{ color: "var(--text-muted)", marginTop: -8 }}>
        ข้อมูลเชิงหมวดหมู่ที่สรุปจากบทสนทนาใน LINE OA เพื่อใช้วิเคราะห์ปรับปรุงบริการและกลยุทธ์การตลาด
      </p>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>ความรู้สึกของลูกค้าในบทสนทนา</h2>
        <p className="sub">
          จำแนกจากข้อความของลูกค้า {sentimentTotal} ข้อความ • ใช้ดูสัญญาณความไม่พอใจที่ควรรีบตามงาน
        </p>
        {sentimentTotal === 0 ? (
          <p className="empty">ยังไม่มีข้อมูลเพียงพอสำหรับแสดงผล</p>
        ) : (
          <div className="grid kpi">
            {SENTIMENT_META.map((meta) => {
              const count = sentimentCounts.get(meta.key) ?? 0;
              const share = sentimentTotal > 0 ? Math.round((count / sentimentTotal) * 100) : 0;
              return (
                <div key={meta.key}>
                  <div className="kpi-value">{share}%</div>
                  <div className="kpi-label">
                    <span className="dot" style={{ background: meta.color }} aria-hidden />
                    {meta.icon} {meta.label} ({count} ข้อความ)
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid" style={{ gap: 16 }}>
        <DailyLineChart
          title={`ลูกค้าใหม่ต่อวัน (${DAYS} วันล่าสุด)`}
          subtitle="ใช้ดูจังหวะการเข้ามาของลูกค้า เทียบกับช่วงที่ทำการตลาด"
          data={daily}
        />
        <CategoryBarChart
          title="ประเภทงานที่ลูกค้าสนใจ"
          subtitle="นับจากลูกค้าที่ระบุประเภทงานในบทสนทนา"
          data={projectTypes}
          valueLabel="จำนวนลูกค้า"
        />
        <CategoryBarChart
          title="หัวข้อที่ลูกค้าถามบ่อย"
          subtitle="ใช้หาช่องว่างของข้อมูลที่ควรเพิ่มในสื่อการตลาดหรือฐานความรู้ของบอท"
          data={topics}
          valueLabel="จำนวนข้อความ"
        />
        <CategoryBarChart
          title="ช่วงงบประมาณที่ลูกค้าแจ้ง"
          subtitle="ข้อมูลจากที่ลูกค้าแจ้งเองเท่านั้น (บอทไม่เสนอราคา)"
          data={budgets}
          valueLabel="จำนวนลูกค้า"
        />
        <CategoryBarChart
          title="พื้นที่/ทำเลของงาน"
          subtitle="ใช้วางแผนพื้นที่ให้บริการและการทำการตลาดเชิงพื้นที่"
          data={locations}
          valueLabel="จำนวนลูกค้า"
        />
      </div>
    </>
  );
}
