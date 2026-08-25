import { randomUUID } from "node:crypto";
import { AuditAction, Prisma, QueueRegion, TesterAvailability, TesterCertificationLevel, TesterStatus, TestingSessionStatus } from "@prisma/client";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type Guild,
  type GuildMember,
  type InteractionEditReplyOptions,
  type Message,
  type Role,
  type StringSelectMenuInteraction,
  type TextChannel,
  userMention
} from "discord.js";
import { prisma } from "../../database/prisma.js";
import { createBaseEmbed } from "../../utils/embeds.js";
import { UserFacingError } from "../../utils/errors.js";
import { logger } from "../../utils/logger.js";
import { GAMEMODE_DEFINITIONS, QUEUE_REGIONS, formatWhitelistRoleName, type QueueRegionLabel } from "../foundation/tiers.js";
import { ensureGuildConfig, ensureStaticDefinitions } from "../setup/service.js";
import { doesTesterRegionMatch, getCertificationLevelForGamemode, getTesterProfile, requireTesterManagementAccess } from "../tester/service.js";

const JOIN_QUEUE_DRAFT_TTL_MS = 10 * 60 * 1000;
const TESTING_QUEUE_VISIBLE_LIMIT = 40;

type JoinQueueDraft = {
  flowId: string;
  guildId: string;
  userId: string;
  region?: QueueRegionLabel;
  gamemode?: string;
  createdAt: number;
};

type QueueWhitelistConfigDetails = Awaited<ReturnType<typeof getQueueConfigBySelection>>;

const joinQueueDrafts = new Map<string, JoinQueueDraft>();

export async function requireQueueStaffAccess(guildId: string, member: GuildMember) {
  return requireTesterManagementAccess(guildId, member);
}

export function buildQueuePanelMessage() {
  return {
    embeds: [
      createBaseEmbed()
        .setTitle("SNOW TIER TESTING")
        .setDescription(["Join a PvP testing queue.", "", "Choose your region and gamemode,", "then wait for a tester to open testing."].join("\n"))
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("queue:join").setLabel("Join Queue").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("queue:leave").setLabel("Leave Queue").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId("queue:mine").setLabel("My Queue").setStyle(ButtonStyle.Secondary)
      )
    ]
  };
}

export function createJoinQueueDraft(guildId: string, userId: string): JoinQueueDraft {
  pruneExpiredJoinQueueDrafts();
  const draft: JoinQueueDraft = { flowId: randomUUID(), guildId, userId, createdAt: Date.now() };
  joinQueueDrafts.set(getJoinQueueDraftKey(guildId, userId, draft.flowId), draft);
  return draft;
}

export function getJoinQueueDraftForInteraction(input: { guildId: string; userId: string; flowId: string }): JoinQueueDraft {
  pruneExpiredJoinQueueDrafts();
  const draft = findJoinQueueDraft(input.guildId, input.flowId);

  if (!draft || draft.userId !== input.userId) {
    throw new UserFacingError("This queue request expired. Please press Join Queue again.");
  }

  return draft;
}

export function updateJoinQueueDraft(input: {
  guildId: string;
  userId: string;
  flowId: string;
  region?: QueueRegionLabel;
  gamemode?: string;
}): JoinQueueDraft {
  const draft = getJoinQueueDraftForInteraction(input);
  const updated = { ...draft, ...(input.region ? { region: input.region } : {}), ...(input.gamemode ? { gamemode: input.gamemode } : {}) };
  joinQueueDrafts.set(getJoinQueueDraftKey(input.guildId, input.userId, input.flowId), updated);
  return updated;
}

export function deleteJoinQueueDraft(input: { guildId: string; userId: string; flowId: string }): void {
  joinQueueDrafts.delete(getJoinQueueDraftKey(input.guildId, input.userId, input.flowId));
}

export async function postOrRefreshQueuePanel(input: { guild: Guild; repost?: boolean }): Promise<Message> {
  const config = await ensureGuildConfig(input.guild.id);

  if (!config.queueChannelId) {
    throw new UserFacingError("Queue panel channel is not configured yet.");
  }

  const channel = await input.guild.channels.fetch(config.queueChannelId).catch(() => null);

  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new UserFacingError("The configured queue panel channel is missing or is not a text channel.");
  }

  if (!input.repost && config.queuePanelMessageId) {
    const existing = await channel.messages.fetch(config.queuePanelMessageId).catch(() => null);

    if (existing) {
      await existing.edit(buildQueuePanelMessage());
      return existing;
    }
  }

  const message = await channel.send(buildQueuePanelMessage());
  await prisma.guildConfig.update({ where: { guildId: input.guild.id }, data: { queuePanelMessageId: message.id } });
  return message;
}

export function buildJoinQueueRegionStep(flowId: string): InteractionEditReplyOptions {
  return {
    embeds: [createBaseEmbed().setTitle("Join Queue").setDescription("Select your region.")],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`queue:select-region:${flowId}`)
          .setPlaceholder("Select a region")
          .addOptions({ label: "AS", description: "Asia", value: "AS" }, { label: "ME", description: "Middle East", value: "ME" })
      )
    ]
  };
}

export function buildJoinQueueGamemodeStep(flowId: string, region: QueueRegionLabel): InteractionEditReplyOptions {
  return {
    embeds: [createBaseEmbed().setTitle("Join Queue").setDescription(`${region}\nSelect your gamemode.`)],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`queue:select-gamemode:${flowId}`)
          .setPlaceholder("Select a gamemode")
          .addOptions(GAMEMODE_DEFINITIONS.map((gamemode) => ({ label: gamemode.label, value: gamemode.label })))
      )
    ]
  };
}

export async function buildJoinQueueConfirmation(input: {
  flowId: string;
  guildId: string;
  region: QueueRegionLabel;
  gamemode: string;
}): Promise<InteractionEditReplyOptions> {
  const config = await getQueueConfigBySelection(input.guildId, input.gamemode, input.region);

  return {
    embeds: [
      createBaseEmbed()
        .setTitle("Join Queue")
        .setDescription([
          `${config.gamemode.label} • ${input.region}`,
          "",
          `You will receive:`,
          formatWhitelistRoleName(config.gamemode.label, input.region)
        ].join("\n"))
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`queue:confirm:${input.flowId}`).setLabel("Join").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`queue:cancel-join:${input.flowId}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
      )
    ]
  };
}

export async function joinQueueByWhitelistRole(input: {
  guild: Guild;
  member: GuildMember;
  gamemode: string;
  region: QueueRegionLabel;
  actorDiscordUserId: string;
}): Promise<{ gamemodeLabel: string; region: QueueRegionLabel; channelId: string }> {
  await ensureStaticDefinitions();
  await ensureGuildConfig(input.guild.id);
  const config = await getQueueConfigBySelection(input.guild.id, input.gamemode, input.region);
  const active = await findMemberActiveQueue(input.guild.id, input.member);

  if (active) {
    throw new UserFacingError(`You're already waiting in ${active.gamemodeLabel} • ${active.region}.\n\nLeave your current queue before joining another.`);
  }

  if (!config.roleId || !config.channelId) {
    throw new UserFacingError("That queue is not fully configured yet.");
  }

  const role = getRequiredRole(input.guild, config.roleId, formatWhitelistRoleName(config.gamemode.label, input.region));
  ensureBotCanManageRole(input.guild, role);

  await input.member.roles.add(role, "Snow Tier whitelist queue join");
  await createAuditLog({ guildId: input.guild.id, action: AuditAction.QUEUE_WHITELIST_JOINED, changedByDiscordUserId: input.actorDiscordUserId, playerDiscordUserId: input.member.id, details: `${config.gamemode.label} ${input.region} ${role.id} ${config.channelId}` });

  return { gamemodeLabel: config.gamemode.label, region: input.region, channelId: config.channelId };
}

export async function leaveOwnQueue(input: { guild: Guild; member: GuildMember; actorDiscordUserId: string }): Promise<{ gamemodeLabel: string; region: QueueRegionLabel }> {
  const active = await findMemberActiveQueue(input.guild.id, input.member);

  if (!active) {
    throw new UserFacingError("You're not currently waiting in a queue.");
  }

  const role = getRequiredRole(input.guild, active.roleId, formatWhitelistRoleName(active.gamemodeLabel, active.region));
  ensureBotCanManageRole(input.guild, role);
  await input.member.roles.remove(role, "Snow Tier whitelist queue leave");
  await removeMemberFromOpenTestingSession({ guild: input.guild, discordUserId: input.member.id, gamemodeLabel: active.gamemodeLabel, refreshReason: AuditAction.TESTING_QUEUE_LEFT }).catch(() => null);
  await createAuditLog({ guildId: input.guild.id, action: AuditAction.QUEUE_WHITELIST_LEFT, changedByDiscordUserId: input.actorDiscordUserId, playerDiscordUserId: input.member.id, details: `${active.gamemodeLabel} ${active.region} ${role.id}` });
  return { gamemodeLabel: active.gamemodeLabel, region: active.region };
}

export async function getOwnQueueStatus(guild: Guild, member: GuildMember): Promise<{ gamemodeLabel: string; region: QueueRegionLabel; channelId: string | null; isOpen: boolean } | null> {
  const active = await findMemberActiveQueue(guild.id, member);

  if (!active) {
    return null;
  }

  return { gamemodeLabel: active.gamemodeLabel, region: active.region, channelId: active.channelId, isOpen: active.isOpen };
}

export async function listQueueEntriesForViewer(input: { guild: Guild; viewerMember: GuildMember; gamemode?: string; region?: QueueRegionLabel }): Promise<Array<{ gamemodeLabel: string; region: QueueRegionLabel; waiting: number; isOpen: boolean }>> {
  const isStaff = await hasQueueStaffAccess(input.guild.id, input.viewerMember);
  const testerProfile = await getTesterProfile(input.guild.id, input.viewerMember.id);

  if (!isStaff && !testerProfile.tester) {
    throw new UserFacingError("You are not authorized to inspect the queue.");
  }

  const configs = await prisma.queueWhitelistConfig.findMany({
    where: {
      guildId: input.guild.id,
      ...(input.region ? { region: QueueRegion[input.region] } : {}),
      ...(input.gamemode ? { gamemode: { label: input.gamemode } } : {})
    },
    include: { gamemode: true },
    orderBy: [{ gamemode: { sortOrder: "asc" } }, { region: "asc" }]
  });

  return configs
    .filter((config) => {
      if (isStaff || !testerProfile.tester) {
        return true;
      }

      const certification = getCertificationLevelForGamemode(testerProfile.tester, config.gamemode.label);
      return certification !== TesterCertificationLevel.NONE && doesTesterRegionMatch(testerProfile.tester.regionAvailability, config.region as QueueRegionLabel);
    })
    .map((config) => ({
      gamemodeLabel: config.gamemode.label,
      region: config.region as QueueRegionLabel,
      waiting: getRoleMemberCount(input.guild, config.roleId),
      isOpen: config.isOpen
    }));
}

export async function openQueueForTester(input: { guild: Guild; member: GuildMember; gamemode: string; region: QueueRegionLabel; actorDiscordUserId: string }): Promise<{ gamemodeLabel: string; region: QueueRegionLabel }> {
  const { tester } = await getTesterProfile(input.guild.id, input.actorDiscordUserId);

  if (!tester) {
    throw new UserFacingError("This member is not a Snow Tier tester.");
  }

  if (tester.status !== TesterStatus.ACTIVE) {
    throw new UserFacingError("Only active testers can open queues.");
  }

  if (tester.availability !== TesterAvailability.AVAILABLE) {
    throw new UserFacingError("You must be AVAILABLE before opening a queue.");
  }

  if (!doesTesterRegionMatch(tester.regionAvailability, input.region)) {
    throw new UserFacingError(`You are not available for ${input.region} queues.`);
  }

  const certification = getCertificationLevelForGamemode(tester, input.gamemode);

  if (certification === TesterCertificationLevel.NONE) {
    throw new UserFacingError(`You are not certified for ${input.gamemode}.`);
  }

  const config = await getQueueConfigBySelection(input.guild.id, input.gamemode, input.region);

  if (!config.roleId || !config.channelId) {
    throw new UserFacingError("That queue is not fully configured yet.");
  }

  const role = getRequiredRole(input.guild, config.roleId, formatWhitelistRoleName(config.gamemode.label, input.region));
  const channel = await getRequiredTextChannel(input.guild, config.channelId);
  const sessionId = randomUUID();

  let createdGamemodeLabel = config.gamemode.label;

  try {
    await prisma.$transaction(async (tx) => {
      const freshConfig = await tx.queueWhitelistConfig.findUnique({
        where: { guildId_gamemodeId_region: { guildId: input.guild.id, gamemodeId: config.gamemodeId, region: QueueRegion[input.region] } },
        include: { gamemode: true }
      });

      if (!freshConfig) {
        throw new UserFacingError("That queue is not configured yet.");
      }

      if (freshConfig.isOpen) {
        throw new UserFacingError(`${freshConfig.gamemode.label} • ${input.region} testing is already open by <@${freshConfig.openedByDiscordUserId}>.`);
      }

      await tx.queueWhitelistConfig.update({
        where: { id: freshConfig.id },
        data: {
          isOpen: true,
          openedAt: new Date(),
          openedByDiscordUserId: input.actorDiscordUserId,
          closedAt: null,
          closedByDiscordUserId: null
        }
      });

      createdGamemodeLabel = freshConfig.gamemode.label;

      await tx.testingSession.create({
        data: {
          id: sessionId,
          guildId: input.guild.id,
          gamemodeId: freshConfig.gamemodeId,
          region: QueueRegion[input.region],
          testerId: tester.id,
          channelId: channel.id,
          messageId: "pending"
        },
        include: { gamemode: true, tester: true }
      });
    });
  } catch (error) {
    if (isTestingSessionOpenConstraintError(error)) {
      const existing = await prisma.testingSession.findFirst({
        where: { guildId: input.guild.id, gamemodeId: config.gamemodeId, region: QueueRegion[input.region], status: TestingSessionStatus.OPEN },
        include: { tester: true, gamemode: true }
      });

      if (existing) {
        throw new UserFacingError(`${existing.gamemode.label} • ${input.region} testing is already open by <@${existing.tester.discordUserId}>.`);
      }
    }

    throw error;
  }

  try {
    const message = await channel.send(buildTestingSessionOpenMessage({
      sessionId,
      roleId: role.id,
      gamemodeLabel: config.gamemode.label,
      region: input.region,
      testerDiscordUserId: input.actorDiscordUserId,
      members: [],
      pingRole: true
    }));

    await prisma.testingSession.update({ where: { id: sessionId }, data: { messageId: message.id } });
  } catch (error) {
    await prisma.$transaction([
      prisma.testingSession.update({ where: { id: sessionId }, data: { status: TestingSessionStatus.CLOSED, closedAt: new Date(), closedByDiscordUserId: input.actorDiscordUserId } }),
      prisma.queueWhitelistConfig.update({
        where: { id: config.id },
        data: { isOpen: false, closedAt: new Date(), closedByDiscordUserId: input.actorDiscordUserId }
      })
    ]).catch(() => null);
    throw error;
  }

  await createAuditLog({ guildId: input.guild.id, action: AuditAction.QUEUE_OPENED, changedByDiscordUserId: input.actorDiscordUserId, testerId: tester.id, details: `${config.gamemode.label} ${input.region} ${role.id} ${channel.id}` });
  await createAuditLog({ guildId: input.guild.id, action: AuditAction.TESTING_SESSION_OPENED, changedByDiscordUserId: input.actorDiscordUserId, testerId: tester.id, details: `${createdGamemodeLabel} ${input.region} ${channel.id}` });
  return { gamemodeLabel: config.gamemode.label, region: input.region };
}

export async function closeQueueForActor(input: { guild: Guild; member: GuildMember; gamemode: string; region: QueueRegionLabel; actorDiscordUserId: string }): Promise<{ gamemodeLabel: string; region: QueueRegionLabel; channelId: string }> {
  const config = await getQueueConfigBySelection(input.guild.id, input.gamemode, input.region);

  const session = await prisma.testingSession.findFirst({
    where: { guildId: input.guild.id, gamemodeId: config.gamemodeId, region: QueueRegion[input.region], status: TestingSessionStatus.OPEN },
    include: { gamemode: true, tester: true },
    orderBy: { openedAt: "desc" }
  });

  if (!session) {
    throw new UserFacingError(`${config.gamemode.label} • ${input.region} testing is already closed.`);
  }

  const isStaff = await hasQueueStaffAccess(input.guild.id, input.member);
  const isOpeningTester = session.tester.discordUserId === input.actorDiscordUserId;

  if (!isStaff && !isOpeningTester) {
    throw new UserFacingError("Only the tester who opened this queue or authorized staff can close it.");
  }

  const closedAt = new Date();
  const updateResult = await prisma.testingSession.updateMany({
    where: { id: session.id, status: TestingSessionStatus.OPEN },
    data: { status: TestingSessionStatus.CLOSED, closedAt, closedByDiscordUserId: input.actorDiscordUserId }
  });

  if (updateResult.count === 0) {
    throw new UserFacingError(`${config.gamemode.label} • ${input.region} testing is already closed.`);
  }

  await prisma.queueWhitelistConfig.update({
    where: { id: config.id },
    data: { isOpen: false, closedAt, closedByDiscordUserId: input.actorDiscordUserId }
  });

  await deleteTestingSessionMessage(input.guild, session.channelId, session.messageId);
  await sendQueueClosedMessage({ guild: input.guild, channelId: session.channelId, gamemodeLabel: session.gamemode.label, region: input.region });

  await createAuditLog({ guildId: input.guild.id, action: AuditAction.QUEUE_CLOSED, changedByDiscordUserId: input.actorDiscordUserId, details: `${session.gamemode.label} ${input.region} ${session.channelId}` });
  await createAuditLog({ guildId: input.guild.id, action: AuditAction.TESTING_SESSION_CLOSED, changedByDiscordUserId: input.actorDiscordUserId, testerId: session.testerId, details: `${session.gamemode.label} ${input.region} ${session.channelId}` });
  return { gamemodeLabel: session.gamemode.label, region: input.region, channelId: session.channelId };
}

export async function removePlayerFromQueue(input: {
  guild: Guild;
  actorMember: GuildMember;
  actorDiscordUserId: string;
  targetMember: GuildMember;
  reason?: string | null;
}): Promise<{ gamemodeLabel: string; region: QueueRegionLabel }> {
  const active = await findMemberActiveQueue(input.guild.id, input.targetMember);

  if (!active) {
    throw new UserFacingError("That player is not currently waiting in a queue.");
  }

  const isStaff = await hasQueueStaffAccess(input.guild.id, input.actorMember);

  if (!isStaff) {
    const { tester } = await getTesterProfile(input.guild.id, input.actorDiscordUserId);

    if (!tester || tester.status !== TesterStatus.ACTIVE) {
      throw new UserFacingError("You do not have permission to remove that player from queue.");
    }

    if (!doesTesterRegionMatch(tester.regionAvailability, active.region)) {
      throw new UserFacingError("You are not available for that queue region.");
    }

    const certification = getCertificationLevelForGamemode(tester, active.gamemodeLabel);

    if (certification === TesterCertificationLevel.NONE) {
      throw new UserFacingError(`You are not certified for ${active.gamemodeLabel}.`);
    }
  }

  const role = getRequiredRole(input.guild, active.roleId, formatWhitelistRoleName(active.gamemodeLabel, active.region));
  ensureBotCanManageRole(input.guild, role);
  await input.targetMember.roles.remove(role, "Snow Tier queue player removal");
  await removeMemberFromOpenTestingSession({ guild: input.guild, discordUserId: input.targetMember.id, gamemodeLabel: active.gamemodeLabel, refreshReason: AuditAction.TESTING_QUEUE_LEFT }).catch(() => null);
  await createAuditLog({ guildId: input.guild.id, action: AuditAction.QUEUE_PLAYER_REMOVED, changedByDiscordUserId: input.actorDiscordUserId, playerDiscordUserId: input.targetMember.id, details: `${active.gamemodeLabel} ${active.region}. Reason: ${input.reason ?? "No reason provided"}` });
  return { gamemodeLabel: active.gamemodeLabel, region: active.region };
}

export async function sendQueueClosedMessage(input: { guild: Guild; channelId: string; gamemodeLabel: string; region: QueueRegionLabel }): Promise<void> {
  const channel = await getRequiredTextChannel(input.guild, input.channelId);
  await channel.send({
    content: [`❄ ${input.gamemodeLabel.toUpperCase()} • ${input.region} TESTING CLOSED`, "", "Testing is no longer accepting players.", "", `Please wait until a tester opens ${input.gamemodeLabel} ${input.region} again.`, "", "Snow Tier"].join("\n"),
    allowedMentions: { parse: [] }
  });
}

export async function joinTestingSessionFromButton(input: { guild: Guild; member: GuildMember; sessionId: string; actorDiscordUserId: string }): Promise<void> {
  const session = await getOpenTestingSessionById(input.sessionId);

  if (!session || session.guildId !== input.guild.id) {
    throw new UserFacingError("That testing session is no longer open.");
  }

  if (session.tester.discordUserId === input.actorDiscordUserId) {
    throw new UserFacingError("You cannot join your own testing queue.");
  }

  const config = await getQueueConfigBySelection(input.guild.id, session.gamemode.label, session.region as QueueRegionLabel);

  if (!config.roleId) {
    throw new UserFacingError("That queue is not fully configured yet.");
  }

  if (!input.member.roles.cache.has(config.roleId)) {
    throw new UserFacingError(`You are not whitelisted for ${session.gamemode.label} • ${session.region}.\n\nJoin the ${session.gamemode.label} ${session.region} whitelist queue first.`);
  }

  try {
    await prisma.$transaction(async (tx) => {
      const openSession = await tx.testingSession.findFirst({ where: { id: session.id, status: TestingSessionStatus.OPEN }, select: { id: true } });

      if (!openSession) {
        throw new UserFacingError("That testing session is no longer open.");
      }

      await tx.testingSessionMember.create({
        data: { sessionId: session.id, discordUserId: input.actorDiscordUserId }
      });

      const stillOpen = await tx.testingSession.findFirst({ where: { id: session.id, status: TestingSessionStatus.OPEN }, select: { id: true } });

      if (!stillOpen) {
        throw new UserFacingError("That testing session is no longer open.");
      }
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new UserFacingError("You're already in this testing queue.");
    }

    throw error;
  }

  await createAuditLog({ guildId: input.guild.id, action: AuditAction.TESTING_QUEUE_JOINED, changedByDiscordUserId: input.actorDiscordUserId, playerDiscordUserId: input.actorDiscordUserId, testerId: session.testerId, details: `${session.gamemode.label} ${session.region} ${session.id}` });
  await refreshTestingSessionMessage(input.guild, session.id);
}

export async function leaveTestingSessionFromButton(input: { guild: Guild; sessionId: string; actorDiscordUserId: string }): Promise<boolean> {
  const session = await getOpenTestingSessionById(input.sessionId);

  if (!session || session.guildId !== input.guild.id) {
    throw new UserFacingError("That testing session is no longer open.");
  }

  const removed = await prisma.testingSessionMember.deleteMany({ where: { sessionId: session.id, discordUserId: input.actorDiscordUserId } });

  if (removed.count === 0) {
    throw new UserFacingError("You're not currently in this testing queue.");
  }

  await createAuditLog({ guildId: input.guild.id, action: AuditAction.TESTING_QUEUE_LEFT, changedByDiscordUserId: input.actorDiscordUserId, playerDiscordUserId: input.actorDiscordUserId, testerId: session.testerId, details: `${session.gamemode.label} ${session.region} ${session.id}` });
  await refreshTestingSessionMessage(input.guild, session.id);
  return true;
}

export async function completeTestingQueueForPlayer(input: { guild: Guild; actorMember: GuildMember; actorDiscordUserId: string; targetMember: GuildMember }): Promise<{ gamemodeLabel: string; region: QueueRegionLabel }> {
  const membership = await findActiveTestingSessionMembership(input.guild.id, input.targetMember.id);

  if (!membership) {
    throw new UserFacingError("That player is not currently waiting in a live testing queue.");
  }

  await assertTestingSessionCompletionAccess({ guild: input.guild, actorMember: input.actorMember, actorDiscordUserId: input.actorDiscordUserId, session: membership.session });
  await removeTestingSessionMembershipAndWhitelistRole({ guild: input.guild, sessionId: membership.session.id, discordUserId: input.targetMember.id, changedByDiscordUserId: input.actorDiscordUserId, action: AuditAction.TESTING_QUEUE_COMPLETED, removeWhitelistRole: true });
  return { gamemodeLabel: membership.session.gamemode.label, region: membership.session.region as QueueRegionLabel };
}

export async function cleanupTestingQueueAfterSuccessfulTierSet(input: { guild: Guild; discordUserId: string; gamemodeLabel: string; changedByDiscordUserId: string }): Promise<string | null> {
  const membership = await findActiveTestingSessionMembership(input.guild.id, input.discordUserId, input.gamemodeLabel);

  if (!membership) {
    return null;
  }

  try {
    await removeTestingSessionMembershipAndWhitelistRole({ guild: input.guild, sessionId: membership.session.id, discordUserId: input.discordUserId, changedByDiscordUserId: input.changedByDiscordUserId, action: AuditAction.TESTING_QUEUE_COMPLETED, removeWhitelistRole: true });
    return null;
  } catch (error) {
    const resolved = error instanceof Error ? error.message : String(error);
    await createAuditLog({ guildId: input.guild.id, action: AuditAction.TESTING_QUEUE_CLEANUP_FAILED, changedByDiscordUserId: input.changedByDiscordUserId, playerDiscordUserId: input.discordUserId, testerId: membership.session.testerId, details: `${membership.session.gamemode.label} ${membership.session.region} ${resolved}` });
    logger.error("Testing queue cleanup failed after successful tier set", { guildId: input.guild.id, sessionId: membership.session.id, discordUserId: input.discordUserId, error: resolved });
    return `Tier updated, but live queue cleanup failed: ${resolved}`;
  }
}

export async function refreshTestingSessionMessage(guild: Guild, sessionId: string): Promise<void> {
  const session = await getOpenTestingSessionById(sessionId);

  if (!session) {
    return;
  }

  const channel = await getRequiredTextChannel(guild, session.channelId);
  if (!session.config?.roleId) {
    throw new UserFacingError("That queue is not fully configured yet.");
  }

  const role = getRequiredRole(guild, session.config.roleId, formatWhitelistRoleName(session.gamemode.label, session.region as QueueRegionLabel));
  const payload = buildTestingSessionOpenMessage({
    sessionId: session.id,
    roleId: role.id,
    gamemodeLabel: session.gamemode.label,
    region: session.region as QueueRegionLabel,
    testerDiscordUserId: session.tester.discordUserId,
    members: session.members,
    pingRole: false
  });

  const message = session.messageId === "pending" ? null : await channel.messages.fetch(session.messageId).catch(() => null);

  if (!message) {
    const replacement = await channel.send(payload);
    await prisma.testingSession.update({ where: { id: session.id }, data: { messageId: replacement.id } });
    await createAuditLog({ guildId: guild.id, action: AuditAction.TESTING_QUEUE_MESSAGE_RECOVERED, changedByDiscordUserId: session.tester.discordUserId, testerId: session.testerId, details: `${session.gamemode.label} ${session.region} ${channel.id} ${replacement.id}` });
    return;
  }

  await message.edit(payload);
  await createAuditLog({ guildId: guild.id, action: AuditAction.TESTING_QUEUE_MESSAGE_REFRESHED, changedByDiscordUserId: session.tester.discordUserId, testerId: session.testerId, details: `${session.gamemode.label} ${session.region} ${channel.id} ${message.id}` });
}

export function buildQueueJoinedEmbed(input: { gamemodeLabel: string; region: QueueRegionLabel; channelId: string }): EmbedBuilder {
  return createBaseEmbed().setTitle("Queue Joined").setDescription(`${input.gamemodeLabel} • ${input.region}\n<#${input.channelId}>\n\nWaiting for Tester`);
}

export function buildOwnQueueEmbed(input: { gamemodeLabel: string; region: QueueRegionLabel; channelId: string | null; isOpen: boolean }): EmbedBuilder {
  return createBaseEmbed().setTitle("Your Queue").setDescription([`${input.gamemodeLabel} • ${input.region}`, input.channelId ? `<#${input.channelId}>` : "Channel not configured", "", "Status", input.isOpen ? "Testing Open" : "Waiting for Tester"].join("\n"));
}

export function buildQueueListMessage(entries: Array<{ gamemodeLabel: string; region: QueueRegionLabel; waiting: number; isOpen: boolean }>): InteractionEditReplyOptions {
  if (entries.length === 0) {
    return { embeds: [createBaseEmbed().setTitle("SNOW TIER QUEUES").setDescription("No matching queues are configured.")] };
  }

  return {
    embeds: [
      createBaseEmbed()
        .setTitle("SNOW TIER QUEUES")
        .setDescription(entries.map((entry) => `${entry.gamemodeLabel} ${entry.region}       ${entry.waiting} waiting${entry.isOpen ? " • OPEN" : ""}`).join("\n"))
    ]
  };
}

export async function sendQueueLog(input: { guild: Guild; title: string; description: string }): Promise<void> {
  const config = await ensureGuildConfig(input.guild.id);

  if (!config.logsChannelId) {
    return;
  }

  const channel = await input.guild.channels.fetch(config.logsChannelId).catch(() => null);

  if (!channel || channel.type !== ChannelType.GuildText) {
    return;
  }

  await channel.send({ embeds: [createBaseEmbed().setTitle(input.title).setDescription(input.description)] }).catch((error) => {
    logger.error("Failed to send queue log message", { guildId: input.guild.id, error: error instanceof Error ? error.message : String(error) });
  });
}

export function isQueueButton(interaction: ButtonInteraction | StringSelectMenuInteraction): boolean {
  return interaction.customId.startsWith("queue:") || interaction.customId.startsWith("testing:");
}

export function isObsoleteQueueComponent(interaction: ButtonInteraction | StringSelectMenuInteraction): boolean {
  return interaction.customId.startsWith("queue:select-tier:") || interaction.customId.startsWith("queue:claim:");
}

async function getQueueConfigBySelection(guildId: string, gamemodeLabel: string, region: QueueRegionLabel) {
  await ensureStaticDefinitions();
  const gamemode = await prisma.gamemodeDefinition.findUnique({ where: { label: gamemodeLabel } });

  if (!gamemode) {
    throw new UserFacingError("Invalid gamemode.");
  }

  const config = await prisma.queueWhitelistConfig.findUnique({
    where: { guildId_gamemodeId_region: { guildId, gamemodeId: gamemode.id, region: QueueRegion[region] } },
    include: { gamemode: true }
  });

  if (!config) {
    throw new UserFacingError("That queue is not configured yet.");
  }

  return config;
}

async function getOpenTestingSessionById(sessionId: string) {
  const session = await prisma.testingSession.findFirst({
    where: { id: sessionId, status: TestingSessionStatus.OPEN },
    include: {
      gamemode: true,
      tester: true,
      members: { orderBy: [{ joinedAt: "asc" }, { id: "asc" }] }
    }
  });

  if (!session) {
    return null;
  }

  const config = await prisma.queueWhitelistConfig.findUnique({
    where: { guildId_gamemodeId_region: { guildId: session.guildId, gamemodeId: session.gamemodeId, region: session.region } },
    include: { gamemode: true }
  });

  return { ...session, config };
}

async function findActiveTestingSessionMembership(guildId: string, discordUserId: string, gamemodeLabel?: string) {
  return prisma.testingSessionMember.findFirst({
    where: {
      discordUserId,
      session: {
        guildId,
        status: TestingSessionStatus.OPEN,
        ...(gamemodeLabel ? { gamemode: { label: gamemodeLabel } } : {})
      }
    },
    include: { session: { include: { gamemode: true, tester: true } } },
    orderBy: { joinedAt: "asc" }
  });
}

async function assertTestingSessionCompletionAccess(input: { guild: Guild; actorMember: GuildMember; actorDiscordUserId: string; session: NonNullable<Awaited<ReturnType<typeof findActiveTestingSessionMembership>>>["session"] }): Promise<void> {
  const isStaff = await hasQueueStaffAccess(input.guild.id, input.actorMember);

  if (isStaff || input.session.tester.discordUserId === input.actorDiscordUserId) {
    return;
  }

  const { tester } = await getTesterProfile(input.guild.id, input.actorDiscordUserId);

  if (!tester || tester.status !== TesterStatus.ACTIVE) {
    throw new UserFacingError("You do not have permission to complete that live queue entry.");
  }

  if (!doesTesterRegionMatch(tester.regionAvailability, input.session.region as QueueRegionLabel)) {
    throw new UserFacingError("You are not available for that queue region.");
  }

  if (getCertificationLevelForGamemode(tester, input.session.gamemode.label) === TesterCertificationLevel.NONE) {
    throw new UserFacingError(`You are not certified for ${input.session.gamemode.label}.`);
  }
}

async function removeTestingSessionMembershipAndWhitelistRole(input: { guild: Guild; sessionId: string; discordUserId: string; changedByDiscordUserId: string; action: AuditAction; removeWhitelistRole: boolean }): Promise<void> {
  const session = await getOpenTestingSessionById(input.sessionId);

  if (!session) {
    throw new UserFacingError("That testing session is no longer open.");
  }

  const deleted = await prisma.testingSessionMember.deleteMany({ where: { sessionId: session.id, discordUserId: input.discordUserId } });

  if (deleted.count === 0) {
    throw new UserFacingError("That player is not currently in this testing queue.");
  }

  if (input.removeWhitelistRole) {
    const config = await getQueueConfigBySelection(session.guildId, session.gamemode.label, session.region as QueueRegionLabel);

    if (config.roleId) {
      const member = await input.guild.members.fetch(input.discordUserId).catch(() => null);

      if (member && member.roles.cache.has(config.roleId)) {
        const role = getRequiredRole(input.guild, config.roleId, formatWhitelistRoleName(session.gamemode.label, session.region as QueueRegionLabel));
        ensureBotCanManageRole(input.guild, role);
        await member.roles.remove(role, "Snow Tier testing queue completion");
      }
    }
  }

  await createAuditLog({ guildId: session.guildId, action: input.action, changedByDiscordUserId: input.changedByDiscordUserId, playerDiscordUserId: input.discordUserId, testerId: session.testerId, details: `${session.gamemode.label} ${session.region} ${session.id}` });
  await refreshTestingSessionMessage(input.guild, session.id);
}

async function removeMemberFromOpenTestingSession(input: { guild: Guild; discordUserId: string; gamemodeLabel: string; refreshReason: AuditAction }): Promise<void> {
  const membership = await findActiveTestingSessionMembership(input.guild.id, input.discordUserId, input.gamemodeLabel);

  if (!membership) {
    return;
  }

  const deleted = await prisma.testingSessionMember.deleteMany({ where: { id: membership.id } });

  if (deleted.count === 0) {
    return;
  }

  await createAuditLog({ guildId: input.guild.id, action: input.refreshReason, changedByDiscordUserId: input.discordUserId, playerDiscordUserId: input.discordUserId, testerId: membership.session.testerId, details: `${membership.session.gamemode.label} ${membership.session.region} ${membership.session.id}` });
  await refreshTestingSessionMessage(input.guild, membership.session.id);
}

function buildTestingSessionOpenMessage(input: { sessionId: string; roleId: string; gamemodeLabel: string; region: QueueRegionLabel; testerDiscordUserId: string; members: Array<{ discordUserId: string }>; pingRole?: boolean }) {
  const lines = input.members.length === 0
    ? ["No players are currently waiting."]
    : [
        ...input.members.slice(0, TESTING_QUEUE_VISIBLE_LIMIT).map((member, index) => `${index + 1} - <@${member.discordUserId}>`),
        ...(input.members.length > TESTING_QUEUE_VISIBLE_LIMIT ? [`+ ${input.members.length - TESTING_QUEUE_VISIBLE_LIMIT} more waiting`] : [])
      ];

  return {
    content: [
      `<@&${input.roleId}>`,
      "",
      `❄ ${input.gamemodeLabel.toUpperCase()} • ${input.region} TESTING OPEN`,
      "",
      `${userMention(input.testerDiscordUserId)} is now accepting tests.`,
      "",
      `If you're waiting for ${input.gamemodeLabel} ${input.region},`,
      "you may now join the queue.",
      "",
      ...lines,
      "",
      "Snow Tier"
    ].join("\n"),
    allowedMentions: input.pingRole ? { parse: [], roles: [input.roleId] } : { parse: [] },
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`testing:join:${input.sessionId}`).setLabel("Join").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`testing:leave:${input.sessionId}`).setLabel("Leave").setStyle(ButtonStyle.Secondary)
      )
    ]
  };
}

async function deleteTestingSessionMessage(guild: Guild, channelId: string, messageId: string): Promise<void> {
  const channel = await getRequiredTextChannel(guild, channelId);
  const message = await channel.messages.fetch(messageId).catch(() => null);

  if (message) {
    await message.delete().catch(() => null);
  }
}

function isTestingSessionOpenConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function findMemberActiveQueue(guildId: string, member: GuildMember): Promise<{ gamemodeLabel: string; region: QueueRegionLabel; roleId: string; channelId: string | null; isOpen: boolean } | null> {
  const configs = await prisma.queueWhitelistConfig.findMany({ where: { guildId, roleId: { not: null } }, include: { gamemode: true } });

  for (const config of configs) {
    if (config.roleId && member.roles.cache.has(config.roleId)) {
      return { gamemodeLabel: config.gamemode.label, region: config.region as QueueRegionLabel, roleId: config.roleId, channelId: config.channelId, isOpen: config.isOpen };
    }
  }

  return null;
}

async function createAuditLog(input: {
  guildId: string;
  action: AuditAction;
  changedByDiscordUserId: string;
  details: string;
  playerDiscordUserId?: string;
  testerId?: string;
}): Promise<void> {
  const player = input.playerDiscordUserId
    ? await prisma.player.upsert({
        where: { guildId_discordUserId: { guildId: input.guildId, discordUserId: input.playerDiscordUserId } },
        update: {},
        create: { guildId: input.guildId, discordUserId: input.playerDiscordUserId }
      })
    : null;

  await prisma.auditLog.create({
    data: { guildId: input.guildId, playerId: player?.id ?? null, testerId: input.testerId ?? null, action: input.action, changedByDiscordUserId: input.changedByDiscordUserId, details: input.details }
  });
}

async function hasQueueStaffAccess(guildId: string, member: GuildMember): Promise<boolean> {
  try {
    await requireQueueStaffAccess(guildId, member);
    return true;
  } catch {
    return false;
  }
}

function getRequiredRole(guild: Guild, roleId: string, roleName: string): Role {
  const role = guild.roles.cache.get(roleId);

  if (!role) {
    throw new UserFacingError(`The configured ${roleName} role is missing or was deleted.`);
  }

  return role;
}

async function getRequiredTextChannel(guild: Guild, channelId: string): Promise<TextChannel> {
  const channel = await guild.channels.fetch(channelId).catch(() => null);

  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new UserFacingError("The configured queue channel is missing or is not a text channel.");
  }

  return channel;
}

function ensureBotCanManageRole(guild: Guild, role: Role): void {
  const botMember = guild.members.me;

  if (!botMember) {
    throw new UserFacingError("Bot member context is unavailable in this server.");
  }

  if (role.managed) {
    throw new UserFacingError(`I can't manage the ${role.name} role.`);
  }

  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles) || botMember.roles.highest.comparePositionTo(role) <= 0) {
    throw new UserFacingError(`I can't manage the ${role.name} role. Move the Snow Tier bot role above it.`);
  }
}

function getRoleMemberCount(guild: Guild, roleId: string | null): number {
  if (!roleId) {
    return 0;
  }

  const role = guild.roles.cache.get(roleId);
  return role?.members.size ?? 0;
}

function getJoinQueueDraftKey(guildId: string, userId: string, flowId: string): string {
  return `${guildId}:${userId}:${flowId}`;
}

function findJoinQueueDraft(guildId: string, flowId: string): JoinQueueDraft | undefined {
  for (const draft of joinQueueDrafts.values()) {
    if (draft.guildId === guildId && draft.flowId === flowId) {
      return draft;
    }
  }

  return undefined;
}

function pruneExpiredJoinQueueDrafts(): void {
  const expiresBefore = Date.now() - JOIN_QUEUE_DRAFT_TTL_MS;

  for (const [key, draft] of joinQueueDrafts.entries()) {
    if (draft.createdAt <= expiresBefore) {
      joinQueueDrafts.delete(key);
    }
  }
}
