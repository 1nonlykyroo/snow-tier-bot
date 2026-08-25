-- CreateEnum
CREATE TYPE "TestingSessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TESTING_SESSION_OPENED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TESTING_SESSION_CLOSED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TESTING_QUEUE_JOINED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TESTING_QUEUE_LEFT';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TESTING_QUEUE_COMPLETED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TESTING_QUEUE_MESSAGE_REFRESHED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TESTING_QUEUE_MESSAGE_RECOVERED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TESTING_QUEUE_CLEANUP_FAILED';

-- CreateTable
CREATE TABLE "TestingSession" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "gamemodeId" TEXT NOT NULL,
    "region" "QueueRegion" NOT NULL,
    "testerId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "status" "TestingSessionStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "closedByDiscordUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestingSessionMember" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestingSessionMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TestingSession_guildId_gamemodeId_region_status_idx" ON "TestingSession"("guildId", "gamemodeId", "region", "status");

-- CreateIndex
CREATE INDEX "TestingSession_guildId_status_openedAt_idx" ON "TestingSession"("guildId", "status", "openedAt");

-- CreateIndex
CREATE INDEX "TestingSession_testerId_status_idx" ON "TestingSession"("testerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TestingSession_open_unique_queue_idx" ON "TestingSession"("guildId", "gamemodeId", "region") WHERE "status" = 'OPEN';

-- CreateIndex
CREATE UNIQUE INDEX "TestingSessionMember_sessionId_discordUserId_key" ON "TestingSessionMember"("sessionId", "discordUserId");

-- CreateIndex
CREATE INDEX "TestingSessionMember_sessionId_joinedAt_idx" ON "TestingSessionMember"("sessionId", "joinedAt");

-- CreateIndex
CREATE INDEX "TestingSessionMember_discordUserId_idx" ON "TestingSessionMember"("discordUserId");

-- AddForeignKey
ALTER TABLE "TestingSession" ADD CONSTRAINT "TestingSession_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestingSession" ADD CONSTRAINT "TestingSession_gamemodeId_fkey" FOREIGN KEY ("gamemodeId") REFERENCES "GamemodeDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestingSession" ADD CONSTRAINT "TestingSession_testerId_fkey" FOREIGN KEY ("testerId") REFERENCES "Tester"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestingSessionMember" ADD CONSTRAINT "TestingSessionMember_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "TestingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
