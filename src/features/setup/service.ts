import { AuditAction, Prisma, QueueRegion, type GuildConfig } from "@prisma/client";
import { ChannelType, type Guild } from "discord.js";
import { prisma } from "../../database/prisma.js";
import {
  CHANNEL_OPTION_LABELS,
  GAMEMODE_DEFINITIONS,
  QUEUE_REGIONS,
  STAFF_ROLE_OPTION_LABELS,
  TIER_DEFINITIONS,
  formatTierRoleName,
  formatWhitelistRoleName,
  type ChannelConfigKey,
  type QueueRegionLabel,
  type StaffRoleConfigKey
} from "../foundation/tiers.js";

export async function ensureStaticDefinitions(): Promise<void> {
  await prisma.$transaction([
    ...GAMEMODE_DEFINITIONS.map((gamemode) =>
      prisma.gamemodeDefinition.upsert({
        where: { key: gamemode.key },
        update: { label: gamemode.label, sortOrder: gamemode.sortOrder },
        create: gamemode
      })
    ),
    ...TIER_DEFINITIONS.map((tier) =>
      prisma.tierDefinition.upsert({
        where: { key: tier.key },
        update: { label: tier.label, sortOrder: tier.sortOrder },
        create: tier
      })
    )
  ]);
}

export async function ensureGuildConfig(guildId: string): Promise<GuildConfig> {
  return prisma.guildConfig.upsert({
    where: { guildId },
    update: {},
    create: { guildId }
  });
}

export async function updateGuildChannelConfig(
  guildId: string,
  key: keyof typeof CHANNEL_OPTION_LABELS,
  channelId: string
): Promise<GuildConfig> {
  const field = CHANNEL_OPTION_LABELS[key] satisfies ChannelConfigKey;
  const data = { [field]: channelId } as Prisma.GuildConfigUpdateInput;

  return prisma.guildConfig.upsert({
    where: { guildId },
    update: data,
    create: { guildId, [field]: channelId }
  });
}

export async function updateGuildRoleConfig(
  guildId: string,
  key: keyof typeof STAFF_ROLE_OPTION_LABELS,
  roleId: string
): Promise<GuildConfig> {
  const field = STAFF_ROLE_OPTION_LABELS[key] satisfies StaffRoleConfigKey;
  const data = { [field]: roleId } as Prisma.GuildConfigUpdateInput;

  return prisma.guildConfig.upsert({
    where: { guildId },
    update: data,
    create: { guildId, [field]: roleId }
  });
}

export async function getSetupOverview(guildId: string): Promise<GuildConfig & { tierRoles: number; whitelistRoles: number; queueChannels: number }> {
  const [config, tierRoles, whitelistRoles, queueChannels] = await prisma.$transaction([
    prisma.guildConfig.findUnique({ where: { guildId } }),
    prisma.tierRole.count({ where: { guildId } }),
    prisma.queueWhitelistConfig.count({ where: { guildId, roleId: { not: null } } }),
    prisma.queueWhitelistConfig.count({ where: { guildId, channelId: { not: null } } })
  ]);

  return {
    ...(config ?? (await ensureGuildConfig(guildId))),
    tierRoles,
    whitelistRoles,
    queueChannels
  };
}

export async function mapTierRole(guildId: string, roleId: string, gamemodeLabel: string, tierLabel: string): Promise<void> {
  await ensureStaticDefinitions();

  const gamemode = await prisma.gamemodeDefinition.findUniqueOrThrow({ where: { label: gamemodeLabel } });
  const tier = await prisma.tierDefinition.findUniqueOrThrow({ where: { label: tierLabel } });

  await ensureGuildConfig(guildId);
  await prisma.tierRole.upsert({
    where: {
      guildId_gamemodeId_tierId: {
        guildId,
        gamemodeId: gamemode.id,
        tierId: tier.id
      }
    },
    update: { roleId },
    create: {
      guildId,
      gamemodeId: gamemode.id,
      tierId: tier.id,
      roleId
    }
  });
}

export async function createOrMapAllTierRoles(guild: Guild): Promise<{ created: string[]; mapped: string[] }> {
  await ensureStaticDefinitions();
  await ensureGuildConfig(guild.id);
  await guild.roles.fetch();

  const gamemodes = await prisma.gamemodeDefinition.findMany({ orderBy: { sortOrder: "asc" } });
  const tiers = await prisma.tierDefinition.findMany({ orderBy: { sortOrder: "asc" } });

  const created: string[] = [];
  const mapped: string[] = [];

  for (const gamemode of gamemodes) {
    for (const tier of tiers) {
      const roleName = formatTierRoleName(gamemode.label, tier.label);
      let role = guild.roles.cache.find((candidate) => candidate.name === roleName);

      if (!role) {
        role = await guild.roles.create({ name: roleName, reason: "Snow Tier Phase 2 setup tier role provisioning" });
        created.push(roleName);
      } else {
        mapped.push(roleName);
      }

      await prisma.tierRole.upsert({
        where: {
          guildId_gamemodeId_tierId: {
            guildId: guild.id,
            gamemodeId: gamemode.id,
            tierId: tier.id
          }
        },
        update: { roleId: role.id },
        create: {
          guildId: guild.id,
          gamemodeId: gamemode.id,
          tierId: tier.id,
          roleId: role.id
        }
      });
    }
  }

  return { created, mapped };
}

export async function createOrMapAllWhitelistRoles(guild: Guild): Promise<{ created: string[]; mapped: string[]; failed: string[] }> {
  await ensureStaticDefinitions();
  await ensureGuildConfig(guild.id);
  await guild.roles.fetch();

  const gamemodes = await prisma.gamemodeDefinition.findMany({ orderBy: { sortOrder: "asc" } });
  const created: string[] = [];
  const mapped: string[] = [];
  const failed: string[] = [];

  for (const gamemode of gamemodes) {
    for (const region of QUEUE_REGIONS) {
      const roleName = formatWhitelistRoleName(gamemode.label, region);

      try {
        const existingConfig = await prisma.queueWhitelistConfig.findUnique({
          where: {
            guildId_gamemodeId_region: {
              guildId: guild.id,
              gamemodeId: gamemode.id,
              region: QueueRegion[region]
            }
          }
        });

        let role = existingConfig?.roleId ? guild.roles.cache.get(existingConfig.roleId) ?? null : null;

        if (!role) {
          role = guild.roles.cache.find((candidate) => candidate.name === roleName) ?? null;
        }

        if (!role) {
          role = await guild.roles.create({
            name: roleName,
            hoist: false,
            mentionable: false,
            reason: "Snow Tier whitelist queue role provisioning"
          });
          created.push(roleName);
        } else {
          mapped.push(roleName);
        }

        await prisma.queueWhitelistConfig.upsert({
          where: {
            guildId_gamemodeId_region: {
              guildId: guild.id,
              gamemodeId: gamemode.id,
              region: QueueRegion[region]
            }
          },
          update: { roleId: role.id },
          create: {
            guildId: guild.id,
            gamemodeId: gamemode.id,
            region: QueueRegion[region],
            roleId: role.id
          }
        });

        await prisma.auditLog.create({
          data: {
            guildId: guild.id,
            action: AuditAction.QUEUE_ROLE_SYNCED,
            changedByDiscordUserId: guild.client.user.id,
            details: `${gamemode.label} ${region} -> ${role.id}`
          }
        });
      } catch (error) {
        failed.push(roleName);

        await prisma.auditLog.create({
          data: {
            guildId: guild.id,
            action: AuditAction.QUEUE_ROLE_SYNC_FAILED,
            changedByDiscordUserId: guild.client.user.id,
            details: `${roleName}: ${error instanceof Error ? error.message : String(error)}`
          }
        });
      }
    }
  }

  return { created, mapped, failed };
}

export async function mapQueueChannel(
  guildId: string,
  gamemodeLabel: string,
  region: QueueRegionLabel,
  channelId: string,
  changedByDiscordUserId: string
): Promise<void> {
  await ensureStaticDefinitions();
  await ensureGuildConfig(guildId);
  const gamemode = await prisma.gamemodeDefinition.findUniqueOrThrow({ where: { label: gamemodeLabel } });

  await prisma.queueWhitelistConfig.upsert({
    where: {
      guildId_gamemodeId_region: {
        guildId,
        gamemodeId: gamemode.id,
        region: QueueRegion[region]
      }
    },
    update: { channelId },
    create: {
      guildId,
      gamemodeId: gamemode.id,
      region: QueueRegion[region],
      channelId
    }
  });

  await prisma.auditLog.create({
    data: {
      guildId,
      action: AuditAction.QUEUE_CHANNEL_CONFIGURED,
      changedByDiscordUserId,
      details: `${gamemodeLabel} ${region} -> ${channelId}`
    }
  });
}

export async function getQueueWhitelistConfigSummary(guildId: string): Promise<Array<{ gamemodeLabel: string; region: QueueRegionLabel; roleId: string | null; channelId: string | null }>> {
  const configs = await prisma.queueWhitelistConfig.findMany({
    where: { guildId },
    include: { gamemode: true },
    orderBy: [{ gamemode: { sortOrder: "asc" } }, { region: "asc" }]
  });

  return configs.map((config) => ({
    gamemodeLabel: config.gamemode.label,
    region: config.region as QueueRegionLabel,
    roleId: config.roleId,
    channelId: config.channelId
  }));
}

export async function updateQueueChannelPermissions(input: {
  guild: Guild;
  gamemodeLabel: string;
  region: QueueRegionLabel;
}): Promise<void> {
  const gamemode = await prisma.gamemodeDefinition.findUniqueOrThrow({ where: { label: input.gamemodeLabel } });
  const config = await prisma.queueWhitelistConfig.findUnique({
    where: {
      guildId_gamemodeId_region: {
        guildId: input.guild.id,
        gamemodeId: gamemode.id,
        region: QueueRegion[input.region]
      }
    }
  });

  if (!config?.roleId || !config.channelId) {
    throw new Error("Whitelist role and queue channel must be configured first.");
  }

  const role = input.guild.roles.cache.get(config.roleId);
  const channel = await input.guild.channels.fetch(config.channelId);
  const guildConfig = await ensureGuildConfig(input.guild.id);

  if (!role || !channel || channel.type !== ChannelType.GuildText) {
    throw new Error("Configured whitelist role or queue channel is missing.");
  }

  const staffRoleIds = [guildConfig.ownerRoleId, guildConfig.administratorRoleId, guildConfig.tierManagerRoleId, guildConfig.headTesterRoleId, guildConfig.seniorTesterRoleId, guildConfig.testerRoleId, guildConfig.trialTesterRoleId].filter(
    (value): value is string => Boolean(value)
  );

  await channel.permissionOverwrites.edit(input.guild.roles.everyone, { ViewChannel: false });
  await channel.permissionOverwrites.edit(role, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });

  for (const staffRoleId of staffRoleIds) {
    const staffRole = input.guild.roles.cache.get(staffRoleId);

    if (staffRole) {
      await channel.permissionOverwrites.edit(staffRole, { ViewChannel: true, ReadMessageHistory: true });
    }
  }
}
