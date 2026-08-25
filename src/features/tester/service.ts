import {
  AuditAction,
  Prisma,
  TesterAvailability,
  TesterCertificationLevel,
  TesterRegion,
  TesterStatus,
  type GamemodeDefinition,
  type GuildConfig,
  type Tester,
  type TesterCertification,
  type TesterCertificationHistory
} from "@prisma/client";
import type { Guild, GuildMember, Role, User } from "discord.js";
import { prisma } from "../../database/prisma.js";
import { UserFacingError } from "../../utils/errors.js";
import { logger } from "../../utils/logger.js";
import { ensureGuildConfig, ensureStaticDefinitions } from "../setup/service.js";

const TESTER_GAMEMODE_LABELS = ["Sword", "Axe", "NethPot", "DiaPot", "SMP", "UHC", "Crystal", "Mace", "SpearMace"] as const;

const CERTIFICATION_ORDER: Record<TesterCertificationLevel, number> = {
  [TesterCertificationLevel.NONE]: 0,
  [TesterCertificationLevel.LOWER]: 1,
  [TesterCertificationLevel.MIDDLE]: 2,
  [TesterCertificationLevel.HIGHER]: 3
};

export type TestingBracket = "LOWER" | "MIDDLE" | "HIGHER";

export type TesterProfile = Tester & {
  certifications: Array<TesterCertification & { gamemode: GamemodeDefinition }>;
};

export type TesterEligibilityFailureReason =
  | "TESTER_NOT_FOUND"
  | "TESTER_NOT_ACTIVE"
  | "TESTER_NOT_AVAILABLE"
  | "CERTIFICATION_TOO_LOW"
  | "REGION_MISMATCH";

export type TesterEligibilityResult =
  | { eligible: true; tester: TesterProfile; certificationLevel: TesterCertificationLevel }
  | { eligible: false; code: TesterEligibilityFailureReason; reason: string };

export type TesterEligibilityCheckInput = {
  gamemode: string;
  bracket: TestingBracket;
  region: "AS" | "ME";
};

export async function requireTesterManagementAccess(guildId: string, member: GuildMember): Promise<GuildConfig> {
  const config = await ensureGuildConfig(guildId);
  const allowedRoleIds = [config.ownerRoleId, config.administratorRoleId, config.tierManagerRoleId, config.headTesterRoleId].filter(
    (value): value is string => Boolean(value)
  );

  if (allowedRoleIds.length === 0) {
    throw new UserFacingError("Tester staff roles are not configured yet.");
  }

  if (!allowedRoleIds.some((roleId) => member.roles.cache.has(roleId))) {
    throw new UserFacingError("You do not have permission to manage testers.");
  }

  return config;
}

export async function requireTesterHistoryAccess(
  guildId: string,
  member: GuildMember,
  targetDiscordUserId: string
): Promise<GuildConfig> {
  if (member.id === targetDiscordUserId) {
    return ensureGuildConfig(guildId);
  }

  return requireTesterManagementAccess(guildId, member);
}

export async function getTesterProfile(guildId: string, discordUserId: string): Promise<{
  tester: TesterProfile | null;
  gamemodes: GamemodeDefinition[];
}> {
  await ensureStaticDefinitions();

  const [tester, gamemodes] = await Promise.all([
    prisma.tester.findUnique({
      where: {
        guildId_discordUserId: {
          guildId,
          discordUserId
        }
      },
      include: {
        certifications: {
          include: { gamemode: true }
        }
      }
    }),
    prisma.gamemodeDefinition.findMany({ orderBy: { sortOrder: "asc" } })
  ]);

  return { tester, gamemodes };
}

export async function addTester(input: {
  guild: Guild;
  targetUser: User;
  changedByDiscordUserId: string;
}): Promise<{ tester: Tester; roleWarning: string | null }> {
  await ensureStaticDefinitions();
  const member = await requireGuildMember(input.guild, input.targetUser.id);

  const tester = await prisma.$transaction(async (tx) => {
    await tx.guildConfig.upsert({ where: { guildId: input.guild.id }, update: {}, create: { guildId: input.guild.id } });

    const existing = await tx.tester.findUnique({
      where: {
        guildId_discordUserId: {
          guildId: input.guild.id,
          discordUserId: input.targetUser.id
        }
      }
    });

    if (existing?.status === TesterStatus.ACTIVE || existing?.status === TesterStatus.SUSPENDED) {
      throw new UserFacingError(`${input.targetUser.toString()} is already a Snow Tier tester.`);
    }

    if (existing?.status === TesterStatus.DISABLED) {
      throw new UserFacingError(`${input.targetUser.toString()} is disabled. Use /tester restore instead.`);
    }

    const created = await tx.tester.create({
      data: {
        guildId: input.guild.id,
        discordUserId: input.targetUser.id,
        status: TesterStatus.ACTIVE,
        availability: TesterAvailability.OFFLINE,
        regionAvailability: TesterRegion.BOTH,
        createdByDiscordUserId: input.changedByDiscordUserId
      }
    });

    await tx.auditLog.create({
      data: {
        guildId: input.guild.id,
        testerId: created.id,
        action: AuditAction.TESTER_ADDED,
        changedByDiscordUserId: input.changedByDiscordUserId,
        details: `Added tester ${input.targetUser.id}.`
      }
    });

    return created;
  });

  const roleWarning = await syncTesterRoleAfterStateChange({
    guild: input.guild,
    member,
    tester,
    changedByDiscordUserId: input.changedByDiscordUserId
  });

  return { tester, roleWarning };
}

export async function removeTester(input: {
  guild: Guild;
  targetUser: User;
  changedByDiscordUserId: string;
  reason: string;
}): Promise<{ tester: Tester; roleWarning: string | null }> {
  const member = await requireGuildMember(input.guild, input.targetUser.id);

  const tester = await prisma.$transaction(async (tx) => {
    const existing = await requireTesterRecord(tx, input.guild.id, input.targetUser.id);

    if (existing.status === TesterStatus.DISABLED) {
      throw new UserFacingError(`${input.targetUser.toString()} is already disabled.`);
    }

    const updated = await tx.tester.update({
      where: { id: existing.id },
      data: {
        status: TesterStatus.DISABLED,
        availability: TesterAvailability.OFFLINE,
        disabledAt: new Date(),
        disabledByDiscordUserId: input.changedByDiscordUserId,
        disabledReason: input.reason,
        suspendedAt: null,
        suspendedByDiscordUserId: null,
        suspendedReason: null
      }
    });

    await tx.auditLog.create({
      data: {
        guildId: input.guild.id,
        testerId: updated.id,
        action: AuditAction.TESTER_DISABLED,
        changedByDiscordUserId: input.changedByDiscordUserId,
        details: `Disabled tester ${input.targetUser.id}. Reason: ${input.reason}`
      }
    });

    return updated;
  });

  const roleWarning = await syncTesterRoleAfterStateChange({
    guild: input.guild,
    member,
    tester,
    changedByDiscordUserId: input.changedByDiscordUserId
  });

  return { tester, roleWarning };
}

export async function suspendTester(input: {
  guildId: string;
  targetUser: User;
  changedByDiscordUserId: string;
  reason: string;
}): Promise<Tester> {
  return prisma.$transaction(async (tx) => {
    const existing = await requireTesterRecord(tx, input.guildId, input.targetUser.id);

    if (existing.status === TesterStatus.DISABLED) {
      throw new UserFacingError("This tester is disabled. Restore them before suspending again.");
    }

    if (existing.status === TesterStatus.SUSPENDED) {
      throw new UserFacingError("This tester is already suspended.");
    }

    const updated = await tx.tester.update({
      where: { id: existing.id },
      data: {
        status: TesterStatus.SUSPENDED,
        availability: TesterAvailability.OFFLINE,
        suspendedAt: new Date(),
        suspendedByDiscordUserId: input.changedByDiscordUserId,
        suspendedReason: input.reason
      }
    });

    await tx.auditLog.create({
      data: {
        guildId: input.guildId,
        testerId: updated.id,
        action: AuditAction.TESTER_SUSPENDED,
        changedByDiscordUserId: input.changedByDiscordUserId,
        details: `Suspended tester ${input.targetUser.id}. Reason: ${input.reason}`
      }
    });

    return updated;
  });
}

export async function restoreTester(input: {
  guild: Guild;
  targetUser: User;
  changedByDiscordUserId: string;
  reason: string;
}): Promise<{ tester: Tester; roleWarning: string | null }> {
  const member = await requireGuildMember(input.guild, input.targetUser.id);

  const tester = await prisma.$transaction(async (tx) => {
    const existing = await requireTesterRecord(tx, input.guild.id, input.targetUser.id);

    if (existing.status === TesterStatus.ACTIVE) {
      throw new UserFacingError(`${input.targetUser.toString()} is already active.`);
    }

    const updated = await tx.tester.update({
      where: { id: existing.id },
      data: {
        status: TesterStatus.ACTIVE,
        availability: TesterAvailability.OFFLINE,
        suspendedAt: null,
        suspendedByDiscordUserId: null,
        suspendedReason: null,
        disabledAt: null,
        disabledByDiscordUserId: null,
        disabledReason: null
      }
    });

    await tx.auditLog.create({
      data: {
        guildId: input.guild.id,
        testerId: updated.id,
        action: AuditAction.TESTER_RESTORED,
        changedByDiscordUserId: input.changedByDiscordUserId,
        details: `Restored tester ${input.targetUser.id}. Reason: ${input.reason}`
      }
    });

    return updated;
  });

  const roleWarning = await syncTesterRoleAfterStateChange({
    guild: input.guild,
    member,
    tester,
    changedByDiscordUserId: input.changedByDiscordUserId
  });

  return { tester, roleWarning };
}

export async function updateOwnTesterAvailability(input: {
  guildId: string;
  discordUserId: string;
  status: TesterAvailability;
  region: TesterRegion;
}): Promise<Tester> {
  return prisma.$transaction(async (tx) => {
    const tester = await requireTesterRecord(tx, input.guildId, input.discordUserId);

    if (input.status === TesterAvailability.AVAILABLE && tester.status !== TesterStatus.ACTIVE) {
      throw new UserFacingError(
        tester.status === TesterStatus.SUSPENDED
          ? "Suspended testers cannot mark themselves available."
          : "Disabled testers cannot mark themselves available."
      );
    }

    const updated = await tx.tester.update({
      where: { id: tester.id },
      data: {
        availability: input.status,
        regionAvailability: input.region
      }
    });

    if (tester.availability !== input.status) {
      await tx.auditLog.create({
        data: {
          guildId: input.guildId,
          testerId: tester.id,
          action: AuditAction.TESTER_AVAILABILITY_CHANGED,
          changedByDiscordUserId: input.discordUserId,
          details: `${tester.availability} -> ${input.status}`
        }
      });
    }

    if (tester.regionAvailability !== input.region) {
      await tx.auditLog.create({
        data: {
          guildId: input.guildId,
          testerId: tester.id,
          action: AuditAction.TESTER_REGION_CHANGED,
          changedByDiscordUserId: input.discordUserId,
          details: `${tester.regionAvailability} -> ${input.region}`
        }
      });
    }

    return updated;
  });
}

export async function certifyTester(input: {
  guildId: string;
  targetUser: User;
  changedByDiscordUserId: string;
  gamemodeLabel: string;
  level: TestingBracket;
  reason: string;
}): Promise<{ tester: Tester; oldLevel: TesterCertificationLevel; newLevel: TesterCertificationLevel }> {
  await ensureStaticDefinitions();
  const gamemode = await requireGamemode(input.gamemodeLabel);

  return prisma.$transaction(async (tx) => {
    const tester = await requireTesterRecord(tx, input.guildId, input.targetUser.id);
    const current = await tx.testerCertification.findUnique({
      where: {
        testerId_gamemodeId: {
          testerId: tester.id,
          gamemodeId: gamemode.id
        }
      }
    });

    const oldLevel = current?.level ?? TesterCertificationLevel.NONE;

    if (oldLevel === input.level) {
      throw new UserFacingError(`${input.targetUser.toString()} is already certified ${input.level} for ${gamemode.label}.`);
    }

    await tx.testerCertification.upsert({
      where: {
        testerId_gamemodeId: {
          testerId: tester.id,
          gamemodeId: gamemode.id
        }
      },
      update: { level: input.level },
      create: {
        testerId: tester.id,
        gamemodeId: gamemode.id,
        level: input.level
      }
    });

    await tx.testerCertificationHistory.create({
      data: {
        guildId: input.guildId,
        testerId: tester.id,
        gamemodeId: gamemode.id,
        oldLevel,
        newLevel: input.level,
        changedByDiscordUserId: input.changedByDiscordUserId,
        reason: input.reason
      }
    });

    await tx.auditLog.create({
      data: {
        guildId: input.guildId,
        testerId: tester.id,
        action: AuditAction.TESTER_CERTIFICATION_CHANGED,
        changedByDiscordUserId: input.changedByDiscordUserId,
        details: `${gamemode.label}: ${oldLevel} -> ${input.level}. Reason: ${input.reason}`
      }
    });

    return { tester, oldLevel, newLevel: input.level };
  });
}

export async function uncertifyTester(input: {
  guildId: string;
  targetUser: User;
  changedByDiscordUserId: string;
  gamemodeLabel: string;
  reason: string;
}): Promise<{ tester: Tester; oldLevel: TesterCertificationLevel }> {
  await ensureStaticDefinitions();
  const gamemode = await requireGamemode(input.gamemodeLabel);

  return prisma.$transaction(async (tx) => {
    const tester = await requireTesterRecord(tx, input.guildId, input.targetUser.id);
    const current = await tx.testerCertification.findUnique({
      where: {
        testerId_gamemodeId: {
          testerId: tester.id,
          gamemodeId: gamemode.id
        }
      }
    });

    if (!current) {
      throw new UserFacingError(`${input.targetUser.toString()} is already uncertified for ${gamemode.label}.`);
    }

    await tx.testerCertification.delete({ where: { id: current.id } });
    await tx.testerCertificationHistory.create({
      data: {
        guildId: input.guildId,
        testerId: tester.id,
        gamemodeId: gamemode.id,
        oldLevel: current.level,
        newLevel: TesterCertificationLevel.NONE,
        changedByDiscordUserId: input.changedByDiscordUserId,
        reason: input.reason
      }
    });

    await tx.auditLog.create({
      data: {
        guildId: input.guildId,
        testerId: tester.id,
        action: AuditAction.TESTER_CERTIFICATION_REMOVED,
        changedByDiscordUserId: input.changedByDiscordUserId,
        details: `${gamemode.label}: ${current.level} -> NONE. Reason: ${input.reason}`
      }
    });

    return { tester, oldLevel: current.level };
  });
}

export async function getTesterCertificationHistory(
  guildId: string,
  discordUserId: string,
  gamemodeLabel?: string
): Promise<Array<TesterCertificationHistory & { gamemode: GamemodeDefinition }>> {
  await ensureStaticDefinitions();

  const tester = await prisma.tester.findUnique({
    where: {
      guildId_discordUserId: {
        guildId,
        discordUserId
      }
    }
  });

  if (!tester) {
    return [];
  }

  const gamemode = gamemodeLabel ? await requireGamemode(gamemodeLabel) : null;

  return prisma.testerCertificationHistory.findMany({
    where: {
      guildId,
      testerId: tester.id,
      ...(gamemode ? { gamemodeId: gamemode.id } : {})
    },
    include: { gamemode: true },
    orderBy: { createdAt: "desc" },
    take: 10
  });
}

export function canTesterHandleBracket(certificationLevel: TesterCertificationLevel, requiredBracket: TestingBracket): boolean {
  return CERTIFICATION_ORDER[certificationLevel] >= CERTIFICATION_ORDER[requiredBracket];
}

export function doesTesterRegionMatch(testerRegion: TesterRegion, requestedRegion: "AS" | "ME"): boolean {
  return testerRegion === TesterRegion.BOTH || testerRegion === requestedRegion;
}

export async function getTesterEligibility(input: {
  guildId: string;
  testerDiscordUserId: string;
  gamemode: string;
  bracket: TestingBracket;
  region: "AS" | "ME";
}): Promise<TesterEligibilityResult> {
  const { tester } = await getTesterProfile(input.guildId, input.testerDiscordUserId);

  if (!tester) {
    return { eligible: false, code: "TESTER_NOT_FOUND", reason: "This member is not a Snow Tier tester." };
  }

  if (tester.status !== TesterStatus.ACTIVE) {
    return {
      eligible: false,
      code: "TESTER_NOT_ACTIVE",
      reason: tester.status === TesterStatus.SUSPENDED ? "This tester is currently suspended." : "This tester is disabled."
    };
  }

  if (tester.availability !== TesterAvailability.AVAILABLE) {
    return {
      eligible: false,
      code: "TESTER_NOT_AVAILABLE",
      reason: `Tester is currently ${tester.availability.toLowerCase()}.`
    };
  }

  const evaluation = evaluateTesterEligibility(tester, input);

  if (!evaluation.eligible) {
    return evaluation;
  }

  return { eligible: true, tester, certificationLevel: evaluation.certificationLevel };
}

export function evaluateTesterEligibility(
  tester: TesterProfile,
  input: TesterEligibilityCheckInput
): { eligible: true; certificationLevel: TesterCertificationLevel } | { eligible: false; code: "CERTIFICATION_TOO_LOW" | "REGION_MISMATCH"; reason: string } {
  const certification = getCertificationLevelForGamemode(tester, input.gamemode);

  if (!canTesterHandleBracket(certification, input.bracket)) {
    return {
      eligible: false,
      code: "CERTIFICATION_TOO_LOW",
      reason: `Tester is only certified ${certification} for ${input.gamemode} tests.`
    };
  }

  if (!doesTesterRegionMatch(tester.regionAvailability, input.region)) {
    return {
      eligible: false,
      code: "REGION_MISMATCH",
      reason: `Tester is not available for ${input.region} queues.`
    };
  }

  return { eligible: true, certificationLevel: certification };
}

export function getCertificationLevelForGamemode(tester: TesterProfile, gamemodeLabel: string): TesterCertificationLevel {
  return tester.certifications.find((entry) => entry.gamemode.label === gamemodeLabel)?.level ?? TesterCertificationLevel.NONE;
}

export function listTesterGamemodeLabels(): readonly string[] {
  return TESTER_GAMEMODE_LABELS;
}

async function requireGamemode(gamemodeLabel: string): Promise<GamemodeDefinition> {
  const gamemode = await prisma.gamemodeDefinition.findUnique({ where: { label: gamemodeLabel } });

  if (!gamemode) {
    throw new UserFacingError("Invalid gamemode.");
  }

  return gamemode;
}

async function requireTesterRecord(
  tx: Prisma.TransactionClient,
  guildId: string,
  discordUserId: string
): Promise<Tester> {
  const tester = await tx.tester.findUnique({
    where: {
      guildId_discordUserId: {
        guildId,
        discordUserId
      }
    }
  });

  if (!tester) {
    throw new UserFacingError("This member is not a Snow Tier tester.");
  }

  return tester;
}

async function requireGuildMember(guild: Guild, discordUserId: string): Promise<GuildMember> {
  const member = await guild.members.fetch(discordUserId).catch(() => null);

  if (!member) {
    throw new UserFacingError("That user is not a member of this server.");
  }

  return member;
}

async function syncTesterRoleAfterStateChange(input: {
  guild: Guild;
  member: GuildMember;
  tester: Tester;
  changedByDiscordUserId: string;
}): Promise<string | null> {
  const config = await ensureGuildConfig(input.guild.id);

  if (!config.testerRoleId) {
    return null;
  }

  try {
    await input.guild.roles.fetch();
    const role = getConfiguredTesterRole(input.guild, config.testerRoleId);
    ensureBotCanManageRole(input.guild, role);

    const shouldHaveRole = input.tester.status !== TesterStatus.DISABLED;
    const hasRole = input.member.roles.cache.has(role.id);

    if (shouldHaveRole && !hasRole) {
      await input.member.roles.add(role, "Snow Tier tester role synchronization");
    }

    if (!shouldHaveRole && hasRole) {
      await input.member.roles.remove(role, "Snow Tier tester role synchronization");
    }

    await prisma.auditLog.create({
      data: {
        guildId: input.guild.id,
        testerId: input.tester.id,
        action: AuditAction.TESTER_ROLE_SYNCED,
        changedByDiscordUserId: input.changedByDiscordUserId,
        details: `${shouldHaveRole ? "Ensured" : "Removed"} tester role ${role.id}`
      }
    });

    return null;
  } catch (error) {
    const resolvedError = error instanceof Error ? error : new Error("Unknown tester role sync failure");

    await prisma.auditLog.create({
      data: {
        guildId: input.guild.id,
        testerId: input.tester.id,
        action: AuditAction.TESTER_ROLE_SYNC_FAILED,
        changedByDiscordUserId: input.changedByDiscordUserId,
        details: resolvedError.message
      }
    });

    logger.error("Tester role sync failed after database update", {
      guildId: input.guild.id,
      testerId: input.tester.id,
      error: resolvedError.message
    });

    return `Database updated, but tester role sync failed: ${resolvedError.message}`;
  }
}

function getConfiguredTesterRole(guild: Guild, roleId: string): Role {
  const role = guild.roles.cache.get(roleId);

  if (!role) {
    throw new UserFacingError("The configured Tester role is missing or was deleted.");
  }

  return role;
}

function ensureBotCanManageRole(guild: Guild, role: Role): void {
  const botMember = guild.members.me;

  if (!botMember) {
    throw new UserFacingError("Bot member context is unavailable in this server.");
  }

  if (role.managed) {
    throw new UserFacingError(`Configured tester role ${role.name} is managed by an integration and cannot be assigned.`);
  }

  if (botMember.roles.highest.comparePositionTo(role) <= 0) {
    throw new UserFacingError(`Bot role must be above ${role.name} to synchronize tester roles.`);
  }
}
