import { PrismaClient } from "@prisma/client";

// Reuse the client across hot reloads / serverless invocations on the same
// warm instance instead of exhausting the DB connection pool.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
