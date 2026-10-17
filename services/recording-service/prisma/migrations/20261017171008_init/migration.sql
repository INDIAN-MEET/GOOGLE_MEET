-- CreateEnum
CREATE TYPE "RecordingStatus" AS ENUM ('STARTING', 'RECORDING', 'STOPPING', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "SegmentStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "Recording" (
    "id" TEXT NOT NULL,
    "roomCode" TEXT NOT NULL,
    "startedBy" TEXT NOT NULL,
    "status" "RecordingStatus" NOT NULL DEFAULT 'STARTING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stoppedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "thumbKey" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Recording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordingSegment" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "peerId" TEXT NOT NULL,
    "userId" TEXT,
    "source" TEXT NOT NULL,
    "hasVideo" BOOLEAN NOT NULL,
    "hasAudio" BOOLEAN NOT NULL,
    "startOffsetMs" INTEGER NOT NULL,
    "durationMs" INTEGER,
    "rawPath" TEXT NOT NULL,
    "storageKey" TEXT,
    "sizeBytes" INTEGER,
    "status" "SegmentStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,

    CONSTRAINT "RecordingSegment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Recording_roomCode_idx" ON "Recording"("roomCode");

-- CreateIndex
CREATE INDEX "Recording_startedBy_idx" ON "Recording"("startedBy");

-- CreateIndex
CREATE INDEX "RecordingSegment_recordingId_idx" ON "RecordingSegment"("recordingId");

-- AddForeignKey
ALTER TABLE "RecordingSegment" ADD CONSTRAINT "RecordingSegment_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording"("id") ON DELETE CASCADE ON UPDATE CASCADE;
