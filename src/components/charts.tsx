"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface CategoryDatum {
  label: string;
  value: number;
}

const AXIS_STYLE = { fontSize: 12, fill: "var(--text-secondary)" } as const;

const TOOLTIP_STYLE = {
  background: "var(--surface-1)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  color: "var(--text-primary)",
  fontSize: 12,
  boxShadow: "var(--shadow-pop)",
} as const;

function ChartCard({
  title,
  columns,
  rows,
  headerExtra,
  children,
}: {
  title: string;
  columns: [string, string];
  rows: Array<[string, number]>;
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);

  return (
    <div className="card">
      <div className="card-head">
        <h2>{title}</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {headerExtra}
          <button className="link-button" onClick={() => setShowTable((v) => !v)}>
            {showTable ? "ดูเป็นกราฟ" : "ดูเป็นตาราง"}
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="empty">ยังไม่มีข้อมูลในช่วงนี้</p>
      ) : showTable ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{columns[0]}</th>
                <th>{columns[1]}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, value]) => (
                <tr key={label}>
                  <td style={{ whiteSpace: "normal" }}>{label}</td>
                  <td>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        children
      )}
    </div>
  );
}

export function CategoryBarChart({
  title,
  data,
  valueLabel = "จำนวน",
}: {
  title: string;
  data: CategoryDatum[];
  valueLabel?: string;
}) {
  const sorted = [...data].sort((a, b) => b.value - a.value);

  return (
    <ChartCard title={title} columns={["หมวด", valueLabel]} rows={sorted.map((d) => [d.label, d.value])}>
      <ResponsiveContainer width="100%" height={Math.max(160, sorted.length * 38 + 24)}>
        <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 32, bottom: 4, left: 4 }}>
          <CartesianGrid horizontal={false} stroke="var(--grid)" />
          <XAxis type="number" tick={AXIS_STYLE} allowDecimals={false} stroke="var(--grid)" />
          <YAxis type="category" dataKey="label" width={140} tick={AXIS_STYLE} stroke="var(--grid)" />
          <Tooltip
            formatter={(value) => [`${value ?? 0}`, valueLabel] as [string, string]}
            contentStyle={TOOLTIP_STYLE}
          />
          <Bar dataKey="value" fill="var(--series-1)" radius={[0, 4, 4, 0]} barSize={16}>
            <LabelList dataKey="value" position="right" style={{ fontSize: 12, fill: "var(--text-secondary)" }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

// Hour-of-day distribution: time reads left-to-right, so this one is vertical
// where the category charts are horizontal. 24 bars is too many to label
// individually — the peak is called out as a stat above the chart instead,
// and the rest is available on hover or in the table view.
export function HourlyBarChart({
  title,
  data,
  valueLabel = "ข้อความ",
}: {
  title: string;
  data: Array<{ hour: number; value: number }>;
  valueLabel?: string;
}) {
  const rows = data.map((d) => [`${String(d.hour).padStart(2, "0")}:00`, d.value] as [string, number]);
  const plot = data.map((d) => ({ ...d, label: `${String(d.hour).padStart(2, "0")}` }));

  return (
    <ChartCard title={title} columns={["ช่วงเวลา", valueLabel]} rows={rows}>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={plot} margin={{ top: 8, right: 8, bottom: 4, left: 4 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="label" tick={AXIS_STYLE} stroke="var(--grid)" interval={1} />
          <YAxis tick={AXIS_STYLE} allowDecimals={false} width={32} stroke="var(--grid)" />
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            labelFormatter={(label) => `${label}:00 - ${label}:59 น.`}
            formatter={(value) => [`${value ?? 0}`, valueLabel] as [string, string]}
            contentStyle={TOOLTIP_STYLE}
          />
          <Bar dataKey="value" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function DailyLineChart({
  title,
  data,
  valueLabel = "ลูกค้าใหม่",
  headerExtra,
}: {
  title: string;
  data: Array<{ date: string; value: number }>;
  valueLabel?: string;
  headerExtra?: React.ReactNode;
}) {
  return (
    <ChartCard
      title={title}
      columns={["วันที่", valueLabel]}
      rows={data.map((d) => [d.date, d.value])}
      headerExtra={headerExtra}
    >
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="date" tick={AXIS_STYLE} stroke="var(--grid)" interval="preserveStartEnd" />
          <YAxis tick={AXIS_STYLE} allowDecimals={false} width={32} stroke="var(--grid)" />
          <Tooltip
            formatter={(value) => [`${value ?? 0}`, valueLabel] as [string, string]}
            contentStyle={TOOLTIP_STYLE}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--series-1)"
            strokeWidth={2}
            // A dot per day is useful at 7 or 30 days and pure noise at 90 —
            // the hover marker still marks the point being read.
            dot={data.length > 40 ? false : { r: 3, strokeWidth: 0, fill: "var(--series-1)" }}
            activeDot={{ r: 5, stroke: "var(--surface-1)", strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
