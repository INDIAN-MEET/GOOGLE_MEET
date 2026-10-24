-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('INVITE', 'REMINDER');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "recipientEmail" TEXT NOT NULL,
    "roomCode" TEXT NOT NULL,
    "roomTitle" TEXT,
    "hostName" TEXT,
    "message" TEXT,
    "meetingAt" TIMESTAMP(3),
    "sendAt" TIMESTAMP(3) NOT NULL,
    "jobId" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Notification_jobId_key" ON "Notification"("jobId");

-- CreateIndex
CREATE INDEX "Notification_roomCode_status_idx" ON "Notification"("roomCode", "status");

-- CreateIndex
CREATE INDEX "Notification_status_sendAt_idx" ON "Notification"("status", "sendAt");
