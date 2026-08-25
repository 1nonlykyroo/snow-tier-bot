import {
  AuditAction,
  Prisma,
  type GamemodeDefinition,
  type Player,
  type TierDefinition
} from "@prisma/client";
import type { Guild, GuildMember, Role, User } from "discord.js";
import { prisma } from "../../database/prisma.js";
import { UserFacingError } from "../../utils/errors.js";
import { logger } from "../../utils/logger.js";
import { cleanupTestingQueueAfterSuccessfulTierSet } from "../queue/service.js";
import { ensureGuildConfig, ensureStaticDefinitions } from "../setup/service.js";

type TierSnapshot = Record<string, string | null>;

type PlayerWithTiers = Player & {
  tiers: Array<{
    gamemode: GamemodeDefinition;
    tier: TierDefinition;
  }>;
};

export async function requireTierStaffAccess(guildId: string, member: GuildMember): Promise<void> {
  const config = await ensureGuildConfig(guildId);
  const allowedRoleIds = [config.tierManagerRoleId, config.administratorRoleId, config.ownerRoleId].filter(
    (value): value is string => Boolean(value)
  );

  if (allowedRoleIds.length === 0) {
    throw new UserFacingError("Tier staff roles are not configured yet. Configure Tier Manager, Administrator, or Owner first.");
  }

  if (!allowedRoleIds.some((roleId) => member.roles.cache.has(roleId))) {
    throw new UserFacingError("You are not authorized to manage player tiers.");
  }
}

export async function setPlayerTier(input: {
  guild: Guild;
  targetUser: User;
  changedByDiscordUserId: string;
  gamemodeLabel: string;
  tierLabel: string;
  reason: string;
}): Promise<{ player: Player; oldTierLabel: string | null; newTierLabel: string; testingQueueCleanupWarning: string | null }> {
  await ensureStaticDefinitions();

  const [gamemode, tier] = await Promise.all([
    prisma.gamemodeDefinition.findUnique({ where: { label: input.gamemodeLabel } }),
    prisma.tierDefinition.findUnique({ where: { label: input.tierLabel } })
  ]);

  if (!gamemode || !tier) {
    throw new UserFacingError("Invalid gamemode or tier.");
  }

  const member = await requireGuildMember(input.guild, input.targetUser.id);

  const result = await prisma.$transaction(async (tx) => {
    const player = await ensurePlayerRecord(tx, input.guild.id, input.targetUser.id);
    const currentTier = await tx.playerTier.findUnique({
      where: {
        playerId_gamemodeId: {
          playerId: player.id,
          gamemodeId: gamemode.id
        }
      },
      include: { tier: true }
    });

    if (currentTier?.tier.label === tier.label) {
      throw new UserFacingError(`${input.targetUser.toString()} is already ${tier.label} in ${gamemode.label}.`);
    }

    await tx.playerTier.upsert({
      where: {
        playerId_gamemodeId: {
          playerId: player.id,
          gamemodeId: gamemode.id
        }
      },
      update: { tierId: tier.id },
      create: {
        playerId: player.id,
        gamemodeId: gamemode.id,
        tierId: tier.id
      }
    });

    await tx.tierHistory.create({
      data: {
        guildId: input.guild.id,
        playerId: player.id,
        gamemodeId: gamemode.id,
        oldTierId: currentTier?.tierId ?? null,
        newTierId: tier.id,
        changedByDiscordUserId: input.changedByDiscordUserId,
        reason: input.reason
      }
    });

    await tx.auditLog.create({
      data: {
        guildId: input.guild.id,
        playerId: player.id,
        action: AuditAction.TIER_CHANGED,
        changedByDiscordUserId: input.changedByDiscordUserId,
        details: `${gamemode.label}: ${currentTier?.tier.label ?? "Unranked"} -> ${tier.label}. Reason: ${input.reason}`
      }
    });

    return {
      player,
      oldTierLabel: currentTier?.tier.label ?? null,
      newTierLabel: tier.label
    };
  });

  await syncRolesAfterTierMutation({
    guild: input.guild,
    member,
    playerId: result.player.id,
    changedByDiscordUserId: input.changedByDiscordUserId
  });

  const testingQueueCleanupWarning = await cleanupTestingQueueAfterSuccessfulTierSet({
    guild: input.guild,
    discordUserId: input.targetUser.id,
    gamemodeLabel: gamemode.label,
    changedByDiscordUserId: input.changedByDiscordUserId
  });

  return { ...result, testingQueueCleanupWarning };
}

export async function removePlayerTier(input: {
  guild: Guild;
  targetUser: User;
  changedByDiscordUserId: string;
  gamemodeLabel: string;
  reason: string;
}): Promise<{ player: Player; removedTierLabel: string }> {
  await ensureStaticDefinitions();

  const gamemode = await prisma.gamemodeDefinition.findUnique({ where: { label: input.gamemodeLabel } });

  if (!gamemode) {
    throw new UserFacingError("Invalid gamemode.");
  }

  const member = await requireGuildMember(input.guild, input.targetUser.id);

  const result = await prisma.$transaction(async (tx) => {
    const player = await ensurePlayerRecord(tx, input.guild.id, input.targetUser.id);
    const currentTier = await tx.playerTier.findUnique({
      where: {
        playerId_gamemodeId: {
          playerId: player.id,
          gamemodeId: gamemode.id
        }
      },
      include: { tier: true }
    });

    if (!currentTier) {
      throw new UserFacingError(`${input.targetUser.toString()} is already unranked in ${gamemode.label}.`);
    }

    await tx.playerTier.delete({ where: { id: currentTier.id } });

    await tx.tierHistory.create({
      data: {
        guildId: input.guild.id,
        playerId: player.id,
        gamemodeId: gamemode.id,
        oldTierId: currentTier.tierId,
        newTierId: null,
        changedByDiscordUserId: input.changedByDiscordUserId,
        reason: input.reason
      }
    });

    await tx.auditLog.create({
      data: {
        guildId: input.guild.id,
        playerId: player.id,
        action: AuditAction.TIER_REMOVED,
        changedByDiscordUserId: input.changedByDiscordUserId,
        details: `${gamemode.label}: removed ${currentTier.tier.label}. Reason: ${input.reason}`
      }
    });

    return {
      player,
      removedTierLabel: currentTier.tier.label
    };
  });

  await syncRolesAfterTierMutation({
    guild: input.guild,
    member,
    playerId: result.player.id,
    changedByDiscordUserId: input.changedByDiscordUserId
  });

  return result;
}

export async function getPlayerTierHistory(guildId: string, discordUserId: string, gamemodeLabel?: string) {
  await ensureStaticDefinitions();

  const player = await prisma.player.findUnique({
    where: {
      guildId_discordUserId: {
        guildId,
        discordUserId
      }
    }
  });

  if (!player) {
    return [];
  }

  const gamemode = gamemodeLabel
    ? await prisma.gamemodeDefinition.findUnique({ where: { label: gamemodeLabel } })
    : null;

  if (gamemodeLabel && !gamemode) {
    throw new UserFacingError("Invalid gamemode.");
  }

  return prisma.tierHistory.findMany({
    where: {
      guildId,
      playerId: player.id,
      ...(gamemode ? { gamemodeId: gamemode.id } : {})
    },
    include: {
      gamemode: true,
      oldTier: true,
      newTier: true
    },
    orderBy: { createdAt: "desc" },
    take: 10
  });
}

export async function getProfile(guildId: string, discordUserId: string): Promise<{
  player: PlayerWithTiers | null;
  gamemodes: GamemodeDefinition[];
}> {
  await ensureStaticDefinitions();

  const [player, gamemodes] = await Promise.all([
    prisma.player.findUnique({
      where: {
        guildId_discordUserId: {
          guildId,
          discordUserId
        }
      },
      include: {
        tiers: {
          include: {
            gamemode: true,
            tier: true
          }
        }
      }
    }),
    prisma.gamemodeDefinition.findMany({ orderBy: { sortOrder: "asc" } })
  ]);

  return { player, gamemodes };
}

export async function reconcilePlayerTierRoles(input: {
  guild: Guild;
  discordUserId: string;
  changedByDiscordUserId: string;
}): Promise<{ added: string[]; removed: string[] }> {
  await ensureStaticDefinitions();

  const member = await requireGuildMember(input.guild, input.discordUserId);
  const player = await prisma.player.findUnique({
    where: {
      guildId_discordUserId: {
        guildId: input.guild.id,
        discordUserId: input.discordUserId
      }
    },
    include: {
      tiers: {
        include: {
          gamemode: true,
          tier: true
        }
      }
    }
  });

  const syncResult = await reconcileMemberTierRoles(input.guild, member, player);

  await prisma.auditLog.create({
    data: {
      guildId: input.guild.id,
      playerId: player?.id ?? null,
      action: AuditAction.ROLE_SYNCED,
      changedByDiscordUserId: input.changedByDiscordUserId,
      details: `Added [${syncResult.added.join(", ") || "none"}] Removed [${syncResult.removed.join(", ") || "none"}]`
    }
  });

  return syncResult;
}

async function syncRolesAfterTierMutation(input: {
  guild: Guild;
  member: GuildMember;
  playerId: string;
  changedByDiscordUserId: string;
}): Promise<void> {
  const player = await prisma.player.findUniqueOrThrow({
    where: { id: input.playerId },
    include: {
      tiers: {
        include: {
          gamemode: true,
          tier: true
        }
      }
    }
  });

  try {
    const syncResult = await reconcileMemberTierRoles(input.guild, input.member, player);

    await prisma.auditLog.create({
      data: {
        guildId: input.guild.id,
        playerId: player.id,
        action: AuditAction.ROLE_SYNCED,
        changedByDiscordUserId: input.changedByDiscordUserId,
        details: `Added [${syncResult.added.join(", ") || "none"}] Removed [${syncResult.removed.join(", ") || "none"}]`
      }
    });
  } catch (error) {
    const resolvedError = error instanceof Error ? error : new Error("Unknown role sync failure");

    await prisma.auditLog.create({
      data: {
        guildId: input.guild.id,
        playerId: player.id,
        action: AuditAction.ROLE_SYNC_FAILED,
        changedByDiscordUserId: input.changedByDiscordUserId,
        details: resolvedError.message
      }
    });

    logger.error("Tier role sync failed after database update", {
      guildId: input.guild.id,
      playerId: player.id,
      error: resolvedError.message
    });

    throw new UserFacingError(`Tier was saved in the database, but Discord role sync failed: ${resolvedError.message}`);
  }
}

async function reconcileMemberTierRoles(
  guild: Guild,
  member: GuildMember,
  player: PlayerWithTiers | null
): Promise<{ added: string[]; removed: string[] }> {
  await guild.roles.fetch();
  const gamemodes = await prisma.gamemodeDefinition.findMany({ orderBy: { sortOrder: "asc" } });
  const tierRoles = await prisma.tierRole.findMany({
    where: { guildId: guild.id },
    include: { gamemode: true, tier: true }
  });

  const desiredByGamemode: TierSnapshot = Object.fromEntries(
    gamemodes.map((gamemode) => [gamemode.id, null])
  );

  for (const currentTier of player?.tiers ?? []) {
    desiredByGamemode[currentTier.gamemode.id] = currentTier.tier.id;
  }

  const added: string[] = [];
  const removed: string[] = [];

  for (const gamemode of gamemodes) {
    const mappings = tierRoles.filter((mapping) => mapping.gamemodeId === gamemode.id);
    const desiredTierId = desiredByGamemode[gamemode.id] ?? null;

    if (desiredTierId && !mappings.some((mapping) => mapping.tierId === desiredTierId)) {
      throw new UserFacingError(`No tier role mapping exists for ${gamemode.label}.`);
    }

    const mappedRoles = mappings.map((mapping) => getRequiredGuildRole(guild, mapping.roleId, gamemode.label));
    const rolesToRemove = mappings
      .filter((mapping) => mapping.tierId !== desiredTierId && member.roles.cache.has(mapping.roleId))
      .map((mapping) => getRequiredGuildRole(guild, mapping.roleId, gamemode.label));

    for (const role of mappedRoles) {
      ensureBotCanManageRole(guild, role);
    }

    for (const role of rolesToRemove) {
      await member.roles.remove(role, "Snow Tier role reconciliation");
      removed.push(role.name);
    }

    if (!desiredTierId) {
      continue;
    }

    const desiredMapping = mappings.find((mapping) => mapping.tierId === desiredTierId);

    if (!desiredMapping) {
      throw new UserFacingError(`No tier role mapping exists for ${gamemode.label}.`);
    }

    const desiredRole = getRequiredGuildRole(guild, desiredMapping.roleId, gamemode.label);
    ensureBotCanManageRole(guild, desiredRole);

    if (!member.roles.cache.has(desiredRole.id)) {
      await member.roles.add(desiredRole, "Snow Tier role reconciliation");
      added.push(desiredRole.name);
    }
  }

  return { added, removed };
}

function ensureBotCanManageRole(guild: Guild, role: Role): void {
  const botMember = guild.members.me;

  if (!botMember) {
    throw new UserFacingError("Bot member context is unavailable in this server.");
  }

  if (role.managed) {
    throw new UserFacingError(`Configured tier role ${role.name} is managed by an integration and cannot be assigned.`);
  }

  if (botMember.roles.highest.comparePositionTo(role) <= 0) {
    throw new UserFacingError(`Bot role must be above ${role.name} to synchronize tier roles.`);
  }
}

function getRequiredGuildRole(guild: Guild, roleId: string, gamemodeLabel: string): Role {
  const role = guild.roles.cache.get(roleId);

  if (!role) {
    throw new UserFacingError(`A configured ${gamemodeLabel} tier role is missing or was deleted.`);
  }

  return role;
}

async function requireGuildMember(guild: Guild, discordUserId: string): Promise<GuildMember> {
  const member = await guild.members.fetch(discordUserId).catch(() => null);

  if (!member) {
    throw new UserFacingError("That user is not a member of this server.");
  }

  return member;
}

async function ensurePlayerRecord(
  tx: Prisma.TransactionClient,
  guildId: string,
  discordUserId: string
): Promise<Player> {
  await tx.guildConfig.upsert({
    where: { guildId },
    update: {},
    create: { guildId }
  });

  return tx.player.upsert({
    where: {
      guildId_discordUserId: {
        guildId,
        discordUserId
      }
    },
    update: {},
    create: {
      guildId,
      discordUserId
    }
  });
}
