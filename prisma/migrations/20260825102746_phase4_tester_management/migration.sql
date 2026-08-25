-- CreateEnum
CREATE TYPE "TesterStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DISABLED');

-- CreateEnum
CREATE TYPE "TesterAvailability" AS ENUM ('AVAILABLE', 'BUSY', 'OFFLINE');

-- CreateEnum
CREATE TYPE "TesterRegion" AS ENUM ('AS', 'ME', 'BOTH');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'TESTER_ADDED';
ALTER TYPE "AuditAction" ADD VALUE 'TESTER_DISABLED';
ALTER TYPE "AuditAction" ADD VALUE 'TESTER_SUSPENDED';
ALTER TYPE "AuditAction" ADD VALUE 'TESTER_RESTORED';
ALTER TYPE "AuditAction" ADD VALUE 'TESTER_AVAILABILITY_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'TESTER_REGION_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'TESTER_CERTIFICATION_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE 'TESTER_CERTIFICATION_REMOVED';
ALTER TYPE "AuditAction" ADD VALUE 'TESTER_ROLE_SYNCED';
ALTER TYPE "AuditAction" ADD VALUE 'TESTER_ROLE_SYNC_FAILED';

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "testerId" TEXT;

-- AlterTable
ALTER TABLE "Tester" ADD COLUMN     "availability" "TesterAvailability" NOT NULL DEFAULT 'OFFLINE',
ADD COLUMN     "createdByDiscordUserId" TEXT,
ADD COLUMN     "disabledAt" TIMESTAMP(3),
ADD COLUMN     "disabledByDiscordUserId" TEXT,
ADD COLUMN     "disabledReason" TEXT,
ADD COLUMN     "regionAvailability" "TesterRegion" NOT NULL DEFAULT 'BOTH',
ADD COLUMN     "status" "TesterStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspendedByDiscordUserId" TEXT,
ADD COLUMN     "suspendedReason" TEXT;

-- CreateTable
CREATE TABLE "TesterCertificationHistory" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "testerId" TEXT NOT NULL,
    "gamemodeId" TEXT NOT NULL,
    "oldLevel" "TesterCertificationLevel" NOT NULL,
    "newLevel" "TesterCertificationLevel" NOT NULL,
    "changedByDiscordUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TesterCertificationHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TesterCertificationHistory_guildId_testerId_createdAt_idx" ON "TesterCertificationHistory"("guildId", "testerId", "createdAt");

-- CreateIndex
CREATE INDEX "TesterCertificationHistory_gamemodeId_idx" ON "TesterCertificationHistory"("gamemodeId");

-- CreateIndex
CREATE INDEX "AuditLog_testerId_idx" ON "AuditLog"("testerId");

-- CreateIndex
CREATE INDEX "Tester_guildId_status_idx" ON "Tester"("guildId", "status");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_testerId_fkey" FOREIGN KEY ("testerId") REFERENCES "Tester"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TesterCertificationHistory" ADD CONSTRAINT "TesterCertificationHistory_gamemodeId_fkey" FOREIGN KEY ("gamemodeId") REFERENCES "GamemodeDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TesterCertificationHistory" ADD CONSTRAINT "TesterCertificationHistory_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "GuildConfig"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TesterCertificationHistory" ADD CONSTRAINT "TesterCertificationHistory_testerId_fkey" FOREIGN KEY ("testerId") REFERENCES "Tester"("id") ON DELETE CASCADE ON UPDATE CASCADE;
