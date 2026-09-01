import { ProjectStatus } from "@prisma/client";

// Named for what staff need to do next, not for what the system did — the
// status column is scanned to find work, so "รอติดต่อกลับ" beats
// "ส่งต่อทีมงานแล้ว".
export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  [ProjectStatus.NEW]: "กำลังเก็บข้อมูล",
  [ProjectStatus.HANDED_OFF]: "รอติดต่อกลับ",
  [ProjectStatus.CONTACTED]: "ติดต่อแล้ว",
  [ProjectStatus.CLOSED]: "ปิดงาน",
};

// Badge tone per status: the one state that needs someone to act on it today
// is the one that gets colour.
export const PROJECT_STATUS_TONE: Record<ProjectStatus, string> = {
  [ProjectStatus.NEW]: "",
  [ProjectStatus.HANDED_OFF]: "warning",
  [ProjectStatus.CONTACTED]: "brand",
  [ProjectStatus.CLOSED]: "good",
};

export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(date);
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "Asia/Bangkok" }).format(date);
}
