-- CreateTable
CREATE TABLE "PendingMessage" (
    "id" TEXT NOT NULL,
    "lineUserId" TEXT NOT NULL,
    "lineMessageId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "replyToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "PendingMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PendingMessage_lineMessageId_key" ON "PendingMessage"("lineMessageId");

-- CreateIndex
CREATE INDEX "PendingMessage_lineUserId_processedAt_idx" ON "PendingMessage"("lineUserId", "processedAt");
