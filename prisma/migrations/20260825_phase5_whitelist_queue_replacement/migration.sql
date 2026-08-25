-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'QUEUE_WHITELIST_JOINED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'QUEUE_WHITELIST_LEFT';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'QUEUE_PLAYER_REMOVED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'QUEUE_OPENED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'QUEUE_CLOSED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'QUEUE_ROLE_SYNCED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'QUEUE_ROLE_SYNC_FAILED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'QUEUE_CHANNEL_CONFIGURED';

-- CreateTable
CREATE TABLE "QueueWhitelistConfig" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "gamemodeId" TEXT NOT NULL,
    "region" "QueueRegion" NOT NULL,
    "roleId" TEXT,
    "channelId" TEXT,
    "isOpen" BOOLEAN NOT NULL DEFAULT false,
    "openedAt" TIMESTAMP(3),
    "openedByDiscordUserId" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedByDiscordUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueueWhitelistConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QueueWhitelistConfig_guildId_gamemodeId_region_key" ON "QueueWhitelistConfig"("guildId", "gamemodeId", "region");

-- CreateIndex
CREATE UNIQUE INDEX "QueueWhitelistConfig_guildId_roleId_key" ON "QueueWhitelistConfig"("guildId", "roleId");

-- CreateIndex
CREATE INDEX "QueueWhitelistConfig_guildId_isOpen_idx" ON "QueueWhitelistConfig"("guildId", "isOpen");

-- CreateIndex
CREATE INDEX "QueueWhitelistConfig_guildId_channelId_idx" ON "QueueWhitelistConfig"("guildId", "channelId");

-- AddForeignKey
ALTER TABLE "QueueWhitelistConfig" ADD CONSTRAINT "QueueWhitelistConfig_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueWhitelistConfig" ADD CONSTRAINT "QueueWhitelistConfig_gamemodeId_fkey" FOREIGN KEY ("gamemodeId") REFERENCES "GamemodeDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
