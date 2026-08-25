-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Gamemode" AS ENUM ('SWORD', 'AXE', 'NETHPOT', 'DIAPOT', 'SMP', 'UHC', 'CRYSTAL', 'MACE', 'SPEARMACE');

-- CreateEnum
CREATE TYPE "TierName" AS ENUM ('LT5', 'HT5', 'LT4', 'HT4', 'LT3', 'HT3', 'LT2', 'HT2', 'LT1', 'HT1');

-- CreateEnum
CREATE TYPE "TesterCertificationLevel" AS ENUM ('NONE', 'LOWER', 'MIDDLE', 'HIGHER');

-- CreateTable
CREATE TABLE "GuildConfig" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "queueChannelId" TEXT,
    "resultsChannelId" TEXT,
    "logsChannelId" TEXT,
    "reviewChannelId" TEXT,
    "testCategoryId" TEXT,
    "ownerRoleId" TEXT,
    "administratorRoleId" TEXT,
    "tierManagerRoleId" TEXT,
    "headTesterRoleId" TEXT,
    "seniorTesterRoleId" TEXT,
    "testerRoleId" TEXT,
    "trialTesterRoleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuildConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerTier" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "gamemodeId" TEXT NOT NULL,
    "tierId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tester" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tester_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TesterCertification" (
    "id" TEXT NOT NULL,
    "testerId" TEXT NOT NULL,
    "gamemodeId" TEXT NOT NULL,
    "level" "TesterCertificationLevel" NOT NULL DEFAULT 'NONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TesterCertification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TierRole" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "gamemodeId" TEXT NOT NULL,
    "tierId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TierRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GamemodeDefinition" (
    "id" TEXT NOT NULL,
    "key" "Gamemode" NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GamemodeDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TierDefinition" (
    "id" TEXT NOT NULL,
    "key" "TierName" NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TierDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuildConfig_guildId_key" ON "GuildConfig"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "Player_discordUserId_key" ON "Player"("discordUserId");

-- CreateIndex
CREATE INDEX "PlayerTier_gamemodeId_idx" ON "PlayerTier"("gamemodeId");

-- CreateIndex
CREATE INDEX "PlayerTier_tierId_idx" ON "PlayerTier"("tierId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerTier_playerId_gamemodeId_key" ON "PlayerTier"("playerId", "gamemodeId");

-- CreateIndex
CREATE INDEX "Tester_discordUserId_idx" ON "Tester"("discordUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Tester_guildId_discordUserId_key" ON "Tester"("guildId", "discordUserId");

-- CreateIndex
CREATE INDEX "TesterCertification_gamemodeId_idx" ON "TesterCertification"("gamemodeId");

-- CreateIndex
CREATE UNIQUE INDEX "TesterCertification_testerId_gamemodeId_key" ON "TesterCertification"("testerId", "gamemodeId");

-- CreateIndex
CREATE INDEX "TierRole_roleId_idx" ON "TierRole"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "TierRole_guildId_gamemodeId_tierId_key" ON "TierRole"("guildId", "gamemodeId", "tierId");

-- CreateIndex
CREATE UNIQUE INDEX "TierRole_guildId_roleId_key" ON "TierRole"("guildId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "GamemodeDefinition_key_key" ON "GamemodeDefinition"("key");

-- CreateIndex
CREATE UNIQUE INDEX "GamemodeDefinition_label_key" ON "GamemodeDefinition"("label");

-- CreateIndex
CREATE UNIQUE INDEX "GamemodeDefinition_sortOrder_key" ON "GamemodeDefinition"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "TierDefinition_key_key" ON "TierDefinition"("key");

-- CreateIndex
CREATE UNIQUE INDEX "TierDefinition_label_key" ON "TierDefinition"("label");

-- CreateIndex
CREATE UNIQUE INDEX "TierDefinition_sortOrder_key" ON "TierDefinition"("sortOrder");

-- AddForeignKey
ALTER TABLE "PlayerTier" ADD CONSTRAINT "PlayerTier_gamemodeId_fkey" FOREIGN KEY ("gamemodeId") REFERENCES "GamemodeDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerTier" ADD CONSTRAINT "PlayerTier_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerTier" ADD CONSTRAINT "PlayerTier_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "TierDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tester" ADD CONSTRAINT "Tester_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TesterCertification" ADD CONSTRAINT "TesterCertification_gamemodeId_fkey" FOREIGN KEY ("gamemodeId") REFERENCES "GamemodeDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TesterCertification" ADD CONSTRAINT "TesterCertification_testerId_fkey" FOREIGN KEY ("testerId") REFERENCES "Tester"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TierRole" ADD CONSTRAINT "TierRole_gamemodeId_fkey" FOREIGN KEY ("gamemodeId") REFERENCES "GamemodeDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TierRole" ADD CONSTRAINT "TierRole_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TierRole" ADD CONSTRAINT "TierRole_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "TierDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed static Phase 2 definitions
INSERT INTO "GamemodeDefinition" ("id", "key", "label", "sortOrder", "createdAt", "updatedAt") VALUES
  ('gm_sword', 'SWORD', 'Sword', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('gm_axe', 'AXE', 'Axe', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('gm_nethpot', 'NETHPOT', 'NethPot', 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('gm_diapot', 'DIAPOT', 'DiaPot', 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('gm_smp', 'SMP', 'SMP', 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('gm_uhc', 'UHC', 'UHC', 6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('gm_crystal', 'CRYSTAL', 'Crystal', 7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('gm_mace', 'MACE', 'Mace', 8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('gm_spearmace', 'SPEARMACE', 'SpearMace', 9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT INTO "TierDefinition" ("id", "key", "label", "sortOrder", "createdAt", "updatedAt") VALUES
  ('tier_lt5', 'LT5', 'LT5', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('tier_ht5', 'HT5', 'HT5', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('tier_lt4', 'LT4', 'LT4', 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('tier_ht4', 'HT4', 'HT4', 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('tier_lt3', 'LT3', 'LT3', 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('tier_ht3', 'HT3', 'HT3', 6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('tier_lt2', 'LT2', 'LT2', 7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('tier_ht2', 'HT2', 'HT2', 8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('tier_lt1', 'LT1', 'LT1', 9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('tier_ht1', 'HT1', 'HT1', 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
