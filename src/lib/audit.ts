import { prisma } from "./db";

// Who did what, to which record, and when — see the AuditLog model in
// prisma/schema.prisma. Every dashboard edit/delete/merge writes one entry
// here so the business can check "which login touched this, and when".
export async function logAudit(params: {
  username: string;
  action: "update" | "delete" | "merge" | "status";
  targetType: "Project";
  targetId: string;
  detail: string;
}): Promise<void> {
  await prisma.auditLog.create({ data: params });
}
