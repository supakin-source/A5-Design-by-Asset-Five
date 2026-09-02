import { MessageRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { CategoryBarChart, DailyLineChart, HourlyBarChart, type CategoryDatum } from "@/components/charts";
import { DateRangePicker } from "./date-range-picker";

export const dynamic = "force-dynamic";

const MAX_CATEGORIES = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 366;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// "Today" and any day-key derived from a stored UTC timestamp are both
// pinned to Bangkok — the business's day boundary, not the server's or the
// viewer's.
function thaiDateKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(d);
}

// Keeps charts readable: the long tail folds into one "อื่น ๆ" bar instead of
// becoming dozens of one-off rows.
function foldTail(data: CategoryDatum[]): CategoryDatum[] {
  const sorted = [...data].sort((a, b) => b.value - a.value);
  if (sorted.length <= MAX_CATEGORIES) return sorted;
  const head = sorted.slice(0, MAX_CATEGORIES - 1);
  const tailTotal = sorted.slice(MAX_CATEGORIES - 1).reduce((sum, d) => sum + d.value, 0);
  return [...head, { label: "อื่น ๆ", value: tailTotal }];
}

// These fields live on Project (one row per job), not on Lead — a returning
// customer's second, unrelated job must count as its own data point rather
// than overwriting the first.
async function projectFieldDistribution(
  field: "projectType" | "budgetRange" | "location",
  range: { gte: Date; lt: Date },
): Promise<CategoryDatum[]> {
  const rows = await prisma.project.groupBy({
    by: [field],
    _count: { _all: true },
    where: { [field]: { not: null }, createdAt: range },
  });
  return foldTail(rows.map((r) => ({ label: r[field] ?? "ไม่ระบุ", value: r._count._all })));
}

const SENTIMENT_META: Array<{ key: string; label: string; color: string; icon: string }> = [
  { key: "positive", label: "เชิงบวก", color: "var(--status-good)", icon: "▲" },
  { key: "neutral", label: "กลาง", color: "var(--text-muted)", icon: "■" },
  { key: "negative", label: "เชิงลบ", color: "var(--status-critical)", icon: "▼" },
];

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const today = thaiDateKey(new Date());

  // Free-form range (calendar picker) instead of a fixed window walked back
  // by whole periods — any two dates, like a hotel-booking date range.
  let from = params.from && ISO_DATE.test(params.from) ? params.from : undefined;
  let to = params.to && ISO_DATE.test(params.to) ? params.to : undefined;
  if (!from || !to) {
    to = today;
    const thirtyAgo = new Date(`${today}T00:00:00+07:00`);
    thirtyAgo.setUTCDate(thirtyAgo.getUTCDate() - 29);
    from = thaiDateKey(thirtyAgo);
  }
  if (from > to) [from, to] = [to, from];
  if (to > today) to = today;

  const windowStart = new Date(`${from}T00:00:00+07:00`);
  const windowEndExclusive = new Date(`${to}T00:00:00+07:00`);
  windowEndExclusive.setUTCDate(windowEndExclusive.getUTCDate() + 1);
  if (windowEndExclusive.getTime() - windowStart.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    windowStart.setTime(windowEndExclusive.getTime() - MAX_RANGE_DAYS * DAY_MS);
  }
  const range = { gte: windowStart, lt: windowEndExclusive };
  const days = Math.round((windowEndExclusive.getTime() - windowStart.getTime()) / DAY_MS);

  const [projectTypes, budgets, locations, topicRows, sentimentRows, projectsInWindow, hourRows] = await Promise.all([
    projectFieldDistribution("projectType", range),
    projectFieldDistribution("budgetRange", range),
    projectFieldDistribution("location", range),
    prisma.message.groupBy({
      by: ["topic"],
      _count: { _all: true },
      where: { topic: { not: null }, role: MessageRole.USER, createdAt: range },
    }),
    prisma.message.groupBy({
      by: ["sentiment"],
      _count: { _all: true },
      where: { sentiment: { not: null }, role: MessageRole.USER, createdAt: range },
    }),
    prisma.project.findMany({ where: { createdAt: range }, select: { createdAt: true } }),
    // Hour of day in Thai local time. Prisma stores DateTime as a naive UTC
    // timestamp, so it has to be labelled UTC before being converted —
    // a single "AT TIME ZONE 'Asia/Bangkok'" would shift it the wrong way.
    prisma.$queryRaw<Array<{ hour: number; count: bigint }>>`
      SELECT EXTRACT(HOUR FROM ("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Bangkok')::int AS hour,
             COUNT(*)::bigint AS count
      FROM "Message"
      WHERE "role" = 'USER'::"MessageRole" AND "createdAt" >= ${windowStart} AND "createdAt" < ${windowEndExclusive}
      GROUP BY 1
      ORDER BY 1
    `,
  ]);

  const topics = foldTail(topicRows.map((r) => ({ label: r.topic ?? "ไม่ระบุ", value: r._count._all })));

  const sentimentTotal = sentimentRows.reduce((sum, r) => sum + r._count._all, 0);
  const sentimentCounts = new Map(sentimentRows.map((r) => [r.sentiment, r._count._all]));

  // Every hour is present even when empty, so the shape of the day is honest
  // rather than only showing the hours that happen to have traffic.
  const hourCounts = new Map(hourRows.map((r) => [Number(r.hour), Number(r.count)]));
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, value: hourCounts.get(hour) ?? 0 }));
  const busiest = hourly.reduce((best, current) => (current.value > best.value ? current : best), hourly[0]);
  const messagesInWindow = hourly.reduce((sum, h) => sum + h.value, 0);

  const dailyCounts = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const key = thaiDateKey(new Date(windowStart.getTime() + i * DAY_MS));
    dailyCounts.set(key, 0);
  }
  for (const project of projectsInWindow) {
    const key = thaiDateKey(project.createdAt);
    if (dailyCounts.has(key)) dailyCounts.set(key, (dailyCounts.get(key) ?? 0) + 1);
  }
  const daily = [...dailyCounts.entries()].map(([date, value]) => ({ date: date.slice(5), value }));

  return (
    <>
      <h1 style={{ marginTop: 0 }}>Market Data</h1>

      <div className="toolbar" style={{ justifyContent: "flex-end", marginBottom: 16 }}>
        <DateRangePicker from={from} to={to} />
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>ช่วงเวลาที่ลูกค้าทักเข้ามามากที่สุด</h2>
        <p className="sub">ใช้จัดเวรทีมงานให้ตรงกับช่วงที่ลูกค้าทักจริง</p>
        {messagesInWindow === 0 ? (
          <p className="empty">ยังไม่มีข้อความในช่วงนี้</p>
        ) : (
          <div className="grid kpi">
            <div>
              <div className="kpi-value">
                {String(busiest.hour).padStart(2, "0")}:00–{String((busiest.hour + 1) % 24).padStart(2, "0")}:00
              </div>
              <div className="kpi-label">ช่วงที่ทักมามากที่สุด ({busiest.value} ข้อความ)</div>
            </div>
            <div>
              <div className="kpi-value">{messagesInWindow}</div>
              <div className="kpi-label">ข้อความจากลูกค้าทั้งช่วง</div>
            </div>
          </div>
        )}
      </div>

      <div className="grid" style={{ gap: 16 }}>
        <HourlyBarChart
          title="ข้อความจากลูกค้าตามช่วงเวลาของวัน"
          subtitle="รวมทุกวันในช่วงที่เลือก · เวลาไทย"
          data={hourly}
          valueLabel="ข้อความ"
        />
        <DailyLineChart
          title="งานที่ติดต่อเข้ามาต่อวัน"
          subtitle="ใช้ดูจังหวะการเข้ามาของลูกค้า เทียบกับช่วงที่ทำการตลาด"
          data={daily}
          valueLabel="งาน"
        />
        <CategoryBarChart
          title="ประเภทงานที่ลูกค้าสนใจ"
          subtitle="นับจากงานที่ระบุประเภทได้"
          data={projectTypes}
          valueLabel="จำนวนงาน"
        />
        <CategoryBarChart
          title="หัวข้อที่ลูกค้าถามบ่อย"
          subtitle="ใช้หาช่องว่างของข้อมูลที่ควรเพิ่มในสื่อการตลาดหรือฐานความรู้ของบอท"
          data={topics}
          valueLabel="ข้อความ"
        />
        <CategoryBarChart
          title="ช่วงงบประมาณที่ลูกค้าแจ้ง"
          subtitle="จากที่ลูกค้าแจ้งเองเท่านั้น — บอทไม่เสนอราคา"
          data={budgets}
          valueLabel="จำนวนงาน"
        />
        <CategoryBarChart
          title="พื้นที่/ทำเลของงาน"
          subtitle="ใช้วางแผนพื้นที่ให้บริการและการตลาดเชิงพื้นที่"
          data={locations}
          valueLabel="จำนวนงาน"
        />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>ความรู้สึกของลูกค้าในบทสนทนา</h2>
        <p className="sub">จาก {sentimentTotal} ข้อความ · ใช้ดูสัญญาณความไม่พอใจที่ควรรีบตามงาน</p>
        {sentimentTotal === 0 ? (
          <p className="empty">ยังไม่มีข้อมูลในช่วงนี้</p>
        ) : (
          <div className="grid kpi">
            {SENTIMENT_META.map((meta) => {
              const count = sentimentCounts.get(meta.key) ?? 0;
              const share = Math.round((count / sentimentTotal) * 100);
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
    </>
  );
}
