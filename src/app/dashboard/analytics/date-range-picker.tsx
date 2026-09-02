"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

// "Today" as a Thai calendar date, independent of the viewer's own timezone —
// the business's day boundary is Bangkok's, not the browser's.
function todayThaiIso(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}

function parseIso(value: string): { year: number; month: number; day: number } {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month: month - 1, day };
}

function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

const MONTH_FORMAT = new Intl.DateTimeFormat("th-TH", { month: "long", year: "numeric" });
const WEEKDAY_LABELS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

// One month grid of a two-month range calendar. Click-click (not real mouse
// drag) selects the range, with a hover preview between the anchor and the
// pointer — the same feel as a booking site's range picker without the
// fragility of real drag-and-drop on touch devices.
function MonthGrid({
  year,
  month,
  start,
  end,
  hovered,
  today,
  onPick,
  onHover,
}: {
  year: number;
  month: number;
  start: string | null;
  end: string | null;
  hovered: string | null;
  today: string;
  onPick: (date: string) => void;
  onHover: (date: string | null) => void;
}) {
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<string | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => iso(year, month, i + 1)),
  ];

  const previewEnd = end ?? hovered;
  const rangeLow = start && previewEnd ? (start < previewEnd ? start : previewEnd) : null;
  const rangeHigh = start && previewEnd ? (start > previewEnd ? start : previewEnd) : null;

  return (
    <div>
      <div style={{ textAlign: "center", fontSize: 13, fontWeight: 500, marginBottom: 8 }}>
        {MONTH_FORMAT.format(new Date(year, month, 1))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} style={{ textAlign: "center", fontSize: 11, color: "var(--text-muted)", padding: "2px 0" }}>
            {w}
          </div>
        ))}
        {cells.map((date, i) => {
          if (!date) return <div key={i} />;
          const isFuture = date > today;
          const isStart = date === start;
          const isEnd = date === end;
          const inRange = rangeLow !== null && rangeHigh !== null && date > rangeLow && date < rangeHigh;
          const isEdge = isStart || isEnd || date === rangeLow || date === rangeHigh;
          return (
            <button
              key={date}
              type="button"
              disabled={isFuture}
              onClick={() => onPick(date)}
              onMouseEnter={() => onHover(date)}
              style={{
                border: "none",
                background: isEdge ? "var(--brand)" : inRange ? "var(--surface-2)" : "none",
                color: isFuture ? "var(--text-muted)" : isEdge ? "var(--text-on-brand)" : "var(--text-primary)",
                borderRadius: 6,
                padding: "6px 0",
                fontSize: 12,
                cursor: isFuture ? "not-allowed" : "pointer",
                opacity: isFuture ? 0.4 : 1,
              }}
            >
              {Number(date.slice(-2))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DateRangePicker({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<string | null>(from);
  const [end, setEnd] = useState<string | null>(to);
  const [hovered, setHovered] = useState<string | null>(null);
  const [view, setView] = useState<{ year: number; month: number }>(() => {
    const { year, month } = parseIso(from);
    return { year, month };
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const today = todayThaiIso();

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  function openPicker() {
    setStart(from);
    setEnd(to);
    const { year, month } = parseIso(from);
    setView({ year, month });
    setOpen(true);
  }

  function pick(date: string) {
    if (!start || end) {
      // Starting a fresh selection, either the first click ever or the next
      // one after a range was already completed.
      setStart(date);
      setEnd(null);
      return;
    }
    setEnd(date < start ? start : date);
    if (date < start) setStart(date);
  }

  function apply(rangeFrom: string, rangeTo: string) {
    setOpen(false);
    router.push(`/dashboard/analytics?from=${rangeFrom}&to=${rangeTo}`);
  }

  const nextMonth = addMonths(view.year, view.month, 1);
  const rangeLabel = `${new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "Asia/Bangkok" }).format(new Date(`${from}T00:00:00+07:00`))} – ${new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "Asia/Bangkok" }).format(new Date(`${to}T00:00:00+07:00`))}`;

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button className="link-button" onClick={() => (open ? setOpen(false) : openPicker())}>
        {rangeLabel}
      </button>

      {open && (
        <div
          className="card"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            zIndex: 20,
            width: 480,
            boxShadow: "var(--shadow-pop)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <button className="link-button" onClick={() => setView(addMonths(view.year, view.month, -1))}>
              ◀
            </button>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {start && !end ? "เลือกวันสิ้นสุด" : "คลิกเพื่อเริ่มเลือกช่วงวันที่"}
            </span>
            <button className="link-button" onClick={() => setView(addMonths(view.year, view.month, 1))}>
              ▶
            </button>
          </div>

          <div style={{ display: "flex", gap: 16 }}>
            <MonthGrid
              year={view.year}
              month={view.month}
              start={start}
              end={end}
              hovered={hovered}
              today={today}
              onPick={pick}
              onHover={setHovered}
            />
            <MonthGrid
              year={nextMonth.year}
              month={nextMonth.month}
              start={start}
              end={end}
              hovered={hovered}
              today={today}
              onPick={pick}
              onHover={setHovered}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
            <button className="link-button" onClick={() => setOpen(false)}>
              ยกเลิก
            </button>
            <button className="primary" disabled={!start || !end} onClick={() => start && end && apply(start, end)}>
              ใช้ช่วงนี้
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
