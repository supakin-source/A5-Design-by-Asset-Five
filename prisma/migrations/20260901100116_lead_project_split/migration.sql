/*
  Splits Lead (customer identity) from a new Project table (one service
  request). Written by hand instead of using the prisma-generated version:
  the auto-generated migration dropped the project fields from Lead and added
  required columns to Conversation/StaffNotification with no backfill, which
  destroys every existing customer's data and fails outright on a non-empty
  table. This version backfills losslessly instead.

  Every existing Lead today already represents exactly one in-flight service
  request, so each gets a Project with the SAME id as the Lead it came from.
  That turns the Conversation/StaffNotification backfill into a plain column
  rename (the value doesn't change) instead of a join, and every existing
  customer's history reads after this migration exactly as it did before it.
*/

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('NEW', 'HANDED_OFF', 'CONTACTED', 'CLOSED');

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "phone" TEXT,
    "projectType" TEXT,
    "projectDetail" TEXT,
    "budgetRange" TEXT,
    "location" TEXT,
    "timeline" TEXT,
    "contactNote" TEXT,
    "notes" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- Backfill one Project per existing Lead, reusing the Lead's id.
INSERT INTO "Project" ("id", "leadId", "phone", "projectType", "projectDetail", "budgetRange", "location", "timeline", "contactNote", "notes", "status", "createdAt", "updatedAt")
SELECT "id", "id", "phone", "projectType", "projectDetail", "budgetRange", "location", "timeline", "contactNote", "notes", "status"::text::"ProjectStatus", "createdAt", "updatedAt"
FROM "Lead";

-- AlterTable: Conversation — add projectId, backfill from the old leadId
-- (equal to the new Project id by construction above), then swap the FK.
ALTER TABLE "Conversation" ADD COLUMN "projectId" TEXT;
UPDATE "Conversation" SET "projectId" = "leadId";
ALTER TABLE "Conversation" ALTER COLUMN "projectId" SET NOT NULL;
ALTER TABLE "Conversation" DROP CONSTRAINT "Conversation_leadId_fkey";
DROP INDEX "Conversation_leadId_idx";
ALTER TABLE "Conversation" DROP COLUMN "leadId";

-- AlterTable: StaffNotification — same treatment.
ALTER TABLE "StaffNotification" ADD COLUMN "projectId" TEXT;
UPDATE "StaffNotification" SET "projectId" = "leadId";
ALTER TABLE "StaffNotification" ALTER COLUMN "projectId" SET NOT NULL;
ALTER TABLE "StaffNotification" DROP CONSTRAINT "StaffNotification_leadId_fkey";
DROP INDEX "StaffNotification_leadId_idx";
ALTER TABLE "StaffNotification" DROP COLUMN "leadId";

-- AlterTable: Lead loses the project-specific fields, now that they live on
-- Project — the values were already copied above, nothing is lost.
DROP INDEX "Lead_status_idx";
ALTER TABLE "Lead" DROP COLUMN "budgetRange",
DROP COLUMN "contactNote",
DROP COLUMN "location",
DROP COLUMN "notes",
DROP COLUMN "phone",
DROP COLUMN "projectDetail",
DROP COLUMN "projectType",
DROP COLUMN "status",
DROP COLUMN "timeline";

DROP TYPE "LeadStatus";

-- CreateIndex
CREATE INDEX "Project_status_idx" ON "Project"("status");

-- CreateIndex
CREATE INDEX "Project_createdAt_idx" ON "Project"("createdAt");

-- CreateIndex
CREATE INDEX "Project_leadId_idx" ON "Project"("leadId");

-- CreateIndex
CREATE INDEX "Conversation_projectId_idx" ON "Conversation"("projectId");

-- CreateIndex
CREATE INDEX "StaffNotification_projectId_idx" ON "StaffNotification"("projectId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffNotification" ADD CONSTRAINT "StaffNotification_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
