-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('TIER_CHANGED', 'TIER_REMOVED', 'ROLE_SYNCED', 'ROLE_SYNC_FAILED');

-- DropIndex
DROP INDEX "Player_discordUserId_key";

-- AlterTable
ALTER TABLE "Player" ADD COLUMN "guildId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "TierHistory" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "gamemodeId" TEXT NOT NULL,
    "oldTierId" TEXT,
    "newTierId" TEXT,
    "changedByDiscordUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TierHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "playerId" TEXT,
    "action" "AuditAction" NOT NULL,
    "changedByDiscordUserId" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TierHistory_guildId_playerId_createdAt_idx" ON "TierHistory"("guildId", "playerId", "createdAt");

-- CreateIndex
CREATE INDEX "TierHistory_gamemodeId_idx" ON "TierHistory"("gamemodeId");

-- CreateIndex
CREATE INDEX "AuditLog_guildId_createdAt_idx" ON "AuditLog"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_playerId_idx" ON "AuditLog"("playerId");

-- CreateIndex
CREATE INDEX "Player_discordUserId_idx" ON "Player"("discordUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Player_guildId_discordUserId_key" ON "Player"("guildId", "discordUserId");

-- AddForeignKey
ALTER TABLE "Player" ADD CONSTRAINT "Player_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TierHistory" ADD CONSTRAINT "TierHistory_gamemodeId_fkey" FOREIGN KEY ("gamemodeId") REFERENCES "GamemodeDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TierHistory" ADD CONSTRAINT "TierHistory_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TierHistory" ADD CONSTRAINT "TierHistory_newTierId_fkey" FOREIGN KEY ("newTierId") REFERENCES "TierDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TierHistory" ADD CONSTRAINT "TierHistory_oldTierId_fkey" FOREIGN KEY ("oldTierId") REFERENCES "TierDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TierHistory" ADD CONSTRAINT "TierHistory_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;
