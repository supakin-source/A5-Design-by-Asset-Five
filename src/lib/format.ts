import { LeadStatus } from "@prisma/client";

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  [LeadStatus.NEW]: "ใหม่ (ยังเก็บข้อมูล)",
  [LeadStatus.HANDED_OFF]: "ส่งต่อทีมงานแล้ว",
  [LeadStatus.CONTACTED]: "ทีมงานติดต่อแล้ว",
  [LeadStatus.CLOSED]: "ปิดเคส",
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
