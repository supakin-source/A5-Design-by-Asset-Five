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

function ChartCard({
  title,
  subtitle,
  columns,
  rows,
  children,
}: {
  title: string;
  subtitle: string;
  columns: [string, string];
  rows: Array<[string, number]>;
  children: React.ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <h2>{title}</h2>
          <p className="sub">{subtitle}</p>
        </div>
        <button className="link-button" onClick={() => setShowTable((v) => !v)}>
          {showTable ? "ดูเป็นกราฟ" : "ดูเป็นตาราง"}
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="empty">ยังไม่มีข้อมูลเพียงพอสำหรับแสดงผล</p>
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
  subtitle,
  data,
  valueLabel = "จำนวน",
}: {
  title: string;
  subtitle: string;
  data: CategoryDatum[];
  valueLabel?: string;
}) {
  const sorted = [...data].sort((a, b) => b.value - a.value);

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      columns={["หมวด", valueLabel]}
      rows={sorted.map((d) => [d.label, d.value])}
    >
      <ResponsiveContainer width="100%" height={Math.max(160, sorted.length * 38 + 24)}>
        <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 32, bottom: 4, left: 4 }}>
          <CartesianGrid horizontal={false} stroke="var(--grid)" />
          <XAxis type="number" tick={AXIS_STYLE} allowDecimals={false} stroke="var(--grid)" />
          <YAxis type="category" dataKey="label" width={140} tick={AXIS_STYLE} stroke="var(--grid)" />
          <Tooltip
            formatter={(value) => [`${value ?? 0}`, valueLabel] as [string, string]}
            contentStyle={{
              background: "var(--surface-1)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--text-primary)",
              fontSize: 12,
            }}
          />
          <Bar dataKey="value" fill="var(--series-1)" radius={[0, 4, 4, 0]} barSize={16}>
            <LabelList dataKey="value" position="right" style={{ fontSize: 12, fill: "var(--text-secondary)" }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function DailyLineChart({
  title,
  subtitle,
  data,
  valueLabel = "ลูกค้าใหม่",
}: {
  title: string;
  subtitle: string;
  data: Array<{ date: string; value: number }>;
  valueLabel?: string;
}) {
  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      columns={["วันที่", valueLabel]}
      rows={data.map((d) => [d.date, d.value])}
    >
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="date" tick={AXIS_STYLE} stroke="var(--grid)" interval="preserveStartEnd" />
          <YAxis tick={AXIS_STYLE} allowDecimals={false} width={32} stroke="var(--grid)" />
          <Tooltip
            formatter={(value) => [`${value ?? 0}`, valueLabel] as [string, string]}
            contentStyle={{
              background: "var(--surface-1)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--text-primary)",
              fontSize: 12,
            }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke="var(--series-1)"
            strokeWidth={2}
            dot={{ r: 3, strokeWidth: 0, fill: "var(--series-1)" }}
            activeDot={{ r: 5, stroke: "var(--surface-1)", strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
