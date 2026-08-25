-- CreateEnum
CREATE TYPE "QueueRegion" AS ENUM ('AS', 'ME');

-- CreateEnum
CREATE TYPE "QueueBracket" AS ENUM ('LOWER', 'MIDDLE', 'HIGHER');

-- CreateEnum
CREATE TYPE "QueueStatus" AS ENUM ('QUEUED', 'CLAIMED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'QUEUE_JOINED';
ALTER TYPE "AuditAction" ADD VALUE 'QUEUE_LEFT';
ALTER TYPE "AuditAction" ADD VALUE 'QUEUE_CANCELLED';
ALTER TYPE "AuditAction" ADD VALUE 'QUEUE_CLAIMED';
ALTER TYPE "AuditAction" ADD VALUE 'QUEUE_RELEASED';
ALTER TYPE "AuditAction" ADD VALUE 'QUEUE_CLAIM_FAILED';

-- AlterTable
ALTER TABLE "GuildConfig" ADD COLUMN "queuePanelMessageId" TEXT;

-- CreateTable
CREATE TABLE "QueueSequence" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "nextDisplayId" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueueSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueEntry" (
    "id" TEXT NOT NULL,
    "displayId" INTEGER NOT NULL,
    "guildId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "region" "QueueRegion" NOT NULL,
    "gamemodeId" TEXT NOT NULL,
    "currentTierId" TEXT,
    "requestedTierId" TEXT NOT NULL,
    "bracket" "QueueBracket" NOT NULL,
    "status" "QueueStatus" NOT NULL DEFAULT 'QUEUED',
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "claimedByTesterId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledByDiscordUserId" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueueEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QueueSequence_guildId_key" ON "QueueSequence"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "QueueEntry_guildId_displayId_key" ON "QueueEntry"("guildId", "displayId");

-- CreateIndex
CREATE INDEX "QueueEntry_guildId_status_queuedAt_idx" ON "QueueEntry"("guildId", "status", "queuedAt");

-- CreateIndex
CREATE INDEX "QueueEntry_playerId_idx" ON "QueueEntry"("playerId");

-- CreateIndex
CREATE INDEX "QueueEntry_claimedByTesterId_idx" ON "QueueEntry"("claimedByTesterId");

-- CreateIndex
CREATE INDEX "QueueEntry_region_idx" ON "QueueEntry"("region");

-- CreateIndex
CREATE INDEX "QueueEntry_gamemodeId_idx" ON "QueueEntry"("gamemodeId");

-- CreateIndex
CREATE INDEX "QueueEntry_requestedTierId_idx" ON "QueueEntry"("requestedTierId");

-- CreateIndex
CREATE INDEX "QueueEntry_guildId_status_region_gamemodeId_bracket_queuedAt_idx" ON "QueueEntry"("guildId", "status", "region", "gamemodeId", "bracket", "queuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "queue_entry_one_active_per_player" ON "QueueEntry"("guildId", "playerId") WHERE "status" IN ('QUEUED', 'CLAIMED');

-- CreateIndex
CREATE UNIQUE INDEX "queue_entry_one_active_claim_per_tester" ON "QueueEntry"("claimedByTesterId") WHERE "status" = 'CLAIMED' AND "claimedByTesterId" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "QueueSequence" ADD CONSTRAINT "QueueSequence_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_gamemodeId_fkey" FOREIGN KEY ("gamemodeId") REFERENCES "GamemodeDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_currentTierId_fkey" FOREIGN KEY ("currentTierId") REFERENCES "TierDefinition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_requestedTierId_fkey" FOREIGN KEY ("requestedTierId") REFERENCES "TierDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_claimedByTesterId_fkey" FOREIGN KEY ("claimedByTesterId") REFERENCES "Tester"("id") ON DELETE SET NULL ON UPDATE CASCADE;
