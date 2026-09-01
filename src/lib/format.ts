import { ProjectStatus } from "@prisma/client";

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  [ProjectStatus.NEW]: "ใหม่ (ยังเก็บข้อมูล)",
  [ProjectStatus.HANDED_OFF]: "ส่งต่อทีมงานแล้ว",
  [ProjectStatus.CONTACTED]: "ทีมงานติดต่อแล้ว",
  [ProjectStatus.CLOSED]: "ปิดเคส",
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
