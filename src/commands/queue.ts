import { SlashCommandBuilder, type ButtonInteraction, type GuildMember, type StringSelectMenuInteraction } from "discord.js";
import type { SlashCommand } from "./types.js";
import { createBaseEmbed } from "../utils/embeds.js";
import { UserFacingError } from "../utils/errors.js";
import { GAMEMODE_DEFINITIONS, QUEUE_REGIONS, type QueueRegionLabel } from "../features/foundation/tiers.js";
import {
  buildJoinQueueConfirmation,
  buildJoinQueueGamemodeStep,
  buildJoinQueueRegionStep,
  buildOwnQueueEmbed,
  buildQueueJoinedEmbed,
  buildQueueListMessage,
  completeTestingQueueForPlayer,
  closeQueueForActor,
  createJoinQueueDraft,
  deleteJoinQueueDraft,
  getJoinQueueDraftForInteraction,
  getOwnQueueStatus,
  isObsoleteQueueComponent,
  isQueueButton,
  joinQueueByWhitelistRole,
  joinTestingSessionFromButton,
  leaveOwnQueue,
  leaveTestingSessionFromButton,
  listQueueEntriesForViewer,
  openQueueForTester,
  postOrRefreshQueuePanel,
  removePlayerFromQueue,
  requireQueueStaffAccess,
  sendQueueLog,
  updateJoinQueueDraft
} from "../features/queue/service.js";

const gamemodeChoices = GAMEMODE_DEFINITIONS.map((gamemode) => ({ name: gamemode.label, value: gamemode.label }));
const regionChoices = QUEUE_REGIONS.map((region) => ({ name: region, value: region }));

export const queueCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Manage the Snow Tier whitelist queue.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("panel")
        .setDescription("Post or refresh the main queue panel.")
        .addBooleanOption((option) => option.setName("repost").setDescription("Post a fresh panel instead of updating the stored one."))
    )
    .addSubcommand((subcommand) => subcommand.setName("join").setDescription("Open the queue join flow."))
    .addSubcommand((subcommand) => subcommand.setName("leave").setDescription("Leave your queue."))
    .addSubcommand((subcommand) => subcommand.setName("status").setDescription("Show your active queue."))
    .addSubcommand((subcommand) =>
      subcommand
        .setName("list")
        .setDescription("Show queue counts.")
        .addStringOption((option) => option.setName("gamemode").setDescription("Filter by gamemode.").addChoices(...gamemodeChoices))
        .addStringOption((option) => option.setName("region").setDescription("Filter by region.").addChoices(...regionChoices))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("open")
        .setDescription("Open one testing queue.")
        .addStringOption((option) => option.setName("gamemode").setDescription("Gamemode.").setRequired(true).addChoices(...gamemodeChoices))
        .addStringOption((option) => option.setName("region").setDescription("Region.").setRequired(true).addChoices(...regionChoices))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("close")
        .setDescription("Close one testing queue.")
        .addStringOption((option) => option.setName("gamemode").setDescription("Gamemode.").setRequired(true).addChoices(...gamemodeChoices))
        .addStringOption((option) => option.setName("region").setDescription("Region.").setRequired(true).addChoices(...regionChoices))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remove")
        .setDescription("Remove a player from their current queue.")
        .addUserOption((option) => option.setName("player").setDescription("Player to remove.").setRequired(true))
        .addStringOption((option) => option.setName("reason").setDescription("Reason.").setRequired(false).setMaxLength(500))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("done")
        .setDescription("Complete one player from the live testing queue.")
        .addUserOption((option) => option.setName("player").setDescription("Player to remove.").setRequired(true))
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) {
      throw new UserFacingError("This command can only be used inside a server.");
    }

    await interaction.deferReply({ ephemeral: true });
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "panel") {
      const actingMember = (await interaction.guild.members.fetch(interaction.user.id)) as GuildMember;
      await requireQueueStaffAccess(interaction.guildId!, actingMember);
      const repost = interaction.options.getBoolean("repost") ?? false;
      const message = await postOrRefreshQueuePanel({ guild: interaction.guild, repost });
      await interaction.editReply({ embeds: [createBaseEmbed().setTitle("Queue Panel Updated").setDescription(`Panel ready in <#${message.channelId}>.`)] });
      return;
    }

    if (subcommand === "join") {
      const draft = createJoinQueueDraft(interaction.guildId!, interaction.user.id);
      await interaction.editReply(buildJoinQueueRegionStep(draft.flowId));
      return;
    }

    if (subcommand === "leave") {
      const member = (await interaction.guild.members.fetch(interaction.user.id)) as GuildMember;
      const result = await leaveOwnQueue({ guild: interaction.guild, member, actorDiscordUserId: interaction.user.id });
      await interaction.editReply({ embeds: [createBaseEmbed().setTitle("Left Queue").setDescription(`${result.gamemodeLabel} • ${result.region}`)] });
      return;
    }

    if (subcommand === "status") {
      const member = (await interaction.guild.members.fetch(interaction.user.id)) as GuildMember;
      const status = await getOwnQueueStatus(interaction.guild, member);

      if (!status) {
        throw new UserFacingError("You're not currently waiting in a queue.");
      }

      await interaction.editReply({ embeds: [buildOwnQueueEmbed(status)] });
      return;
    }

    if (subcommand === "list") {
      const actingMember = (await interaction.guild.members.fetch(interaction.user.id)) as GuildMember;
      const gamemode = interaction.options.getString("gamemode") ?? undefined;
      const region = (interaction.options.getString("region") as QueueRegionLabel | null) ?? undefined;
      const entries = await listQueueEntriesForViewer({
        guild: interaction.guild,
        viewerMember: actingMember,
        ...(gamemode ? { gamemode } : {}),
        ...(region ? { region } : {})
      });
      await interaction.editReply(buildQueueListMessage(entries));
      return;
    }

    if (subcommand === "open") {
      const member = (await interaction.guild.members.fetch(interaction.user.id)) as GuildMember;
      const gamemode = interaction.options.getString("gamemode", true);
      const region = interaction.options.getString("region", true) as QueueRegionLabel;
      const opened = await openQueueForTester({ guild: interaction.guild, member, gamemode, region, actorDiscordUserId: interaction.user.id });
      await sendQueueLog({ guild: interaction.guild, title: "Queue Opened", description: `${opened.gamemodeLabel} • ${opened.region} opened by <@${interaction.user.id}>.` });
      await interaction.editReply({ embeds: [createBaseEmbed().setTitle("Queue Opened").setDescription(`${opened.gamemodeLabel} • ${opened.region}`)] });
      return;
    }

    if (subcommand === "close") {
      const member = (await interaction.guild.members.fetch(interaction.user.id)) as GuildMember;
      const gamemode = interaction.options.getString("gamemode", true);
      const region = interaction.options.getString("region", true) as QueueRegionLabel;
      const closed = await closeQueueForActor({ guild: interaction.guild, member, gamemode, region, actorDiscordUserId: interaction.user.id });
      await sendQueueLog({ guild: interaction.guild, title: "Queue Closed", description: `${closed.gamemodeLabel} • ${closed.region} closed by <@${interaction.user.id}>.` });
      await interaction.editReply({ embeds: [createBaseEmbed().setTitle("Queue Closed").setDescription(`${closed.gamemodeLabel} • ${closed.region}`)] });
      return;
    }

    const actorMember = (await interaction.guild.members.fetch(interaction.user.id)) as GuildMember;
    const targetUser = interaction.options.getUser("player", true);
    const targetMember = (await interaction.guild.members.fetch(targetUser.id).catch(() => null)) as GuildMember | null;

    if (!targetMember) {
      throw new UserFacingError("That user is not a member of this server.");
    }

    if (subcommand === "done") {
      const completed = await completeTestingQueueForPlayer({ guild: interaction.guild, actorMember, actorDiscordUserId: interaction.user.id, targetMember });
      await sendQueueLog({ guild: interaction.guild, title: "Testing Queue Completed", description: `Removed <@${targetUser.id}> from ${completed.gamemodeLabel} • ${completed.region} live queue.` });
      await interaction.editReply({ embeds: [createBaseEmbed().setTitle("Testing Queue Updated").setDescription(`Removed <@${targetUser.id}> from ${completed.gamemodeLabel} • ${completed.region} live queue.`)] });
      return;
    }

    const removed = await removePlayerFromQueue({ guild: interaction.guild, actorMember, actorDiscordUserId: interaction.user.id, targetMember, reason: interaction.options.getString("reason") });
    await sendQueueLog({ guild: interaction.guild, title: "Queue Player Removed", description: `Removed <@${targetUser.id}> from ${removed.gamemodeLabel} • ${removed.region} queue.` });
    await interaction.editReply({ embeds: [createBaseEmbed().setTitle("Queue Player Removed").setDescription(`Removed <@${targetUser.id}> from ${removed.gamemodeLabel} • ${removed.region} queue.`)] });
  }
};

export async function handleQueueComponentInteraction(interaction: ButtonInteraction | StringSelectMenuInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild || !isQueueButton(interaction)) {
    return;
  }

  if (isObsoleteQueueComponent(interaction)) {
    await respondOutdatedPanel(interaction);
    return;
  }

  if (interaction.customId === "queue:join") {
    const draft = createJoinQueueDraft(interaction.guildId!, interaction.user.id);
    await interaction.reply({ ...(buildJoinQueueRegionStep(draft.flowId) as object), ephemeral: true });
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith("testing:join:")) {
    const sessionId = expectCustomIdPart(interaction.customId, 2);
    await interaction.deferReply({ ephemeral: true });
    const member = (await interaction.guild.members.fetch(interaction.user.id)) as GuildMember;
    await joinTestingSessionFromButton({ guild: interaction.guild, member, sessionId, actorDiscordUserId: interaction.user.id });
    await interaction.editReply({ embeds: [createBaseEmbed().setTitle("Joined Testing Queue").setDescription("You were added to the live queue.")] });
    return;
  }

  if (interaction.isButton() && interaction.customId.startsWith("testing:leave:")) {
    const sessionId = expectCustomIdPart(interaction.customId, 2);
    await interaction.deferReply({ ephemeral: true });
    await leaveTestingSessionFromButton({ guild: interaction.guild, sessionId, actorDiscordUserId: interaction.user.id });
    await interaction.editReply({ embeds: [createBaseEmbed().setTitle("Left Testing Queue").setDescription("You were removed from the live queue.")] });
    return;
  }

  if (interaction.customId === "queue:leave") {
    await interaction.deferReply({ ephemeral: true });
    const member = (await interaction.guild.members.fetch(interaction.user.id)) as GuildMember;
    const result = await leaveOwnQueue({ guild: interaction.guild, member, actorDiscordUserId: interaction.user.id });
    await interaction.editReply({ embeds: [createBaseEmbed().setTitle("Left Queue").setDescription(`${result.gamemodeLabel} • ${result.region}`)] });
    return;
  }

  if (interaction.customId === "queue:mine") {
    await interaction.deferReply({ ephemeral: true });
    const member = (await interaction.guild.members.fetch(interaction.user.id)) as GuildMember;
    const status = await getOwnQueueStatus(interaction.guild, member);

    if (!status) {
      throw new UserFacingError("You're not currently waiting in a queue.");
    }

    await interaction.editReply({ embeds: [buildOwnQueueEmbed(status)] });
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("queue:select-region:")) {
    const flowId = expectCustomIdPart(interaction.customId, 2);
    const region = expectSelectedValue(interaction.values) as QueueRegionLabel;
    getJoinQueueDraftForInteraction({ guildId: interaction.guildId!, userId: interaction.user.id, flowId });
    updateJoinQueueDraft({ guildId: interaction.guildId!, userId: interaction.user.id, flowId, region });
    await interaction.update(buildJoinQueueGamemodeStep(flowId, region));
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith("queue:select-gamemode:")) {
    const flowId = expectCustomIdPart(interaction.customId, 2);
    const gamemode = expectSelectedValue(interaction.values);
    const draft = getJoinQueueDraftForInteraction({ guildId: interaction.guildId!, userId: interaction.user.id, flowId });

    if (!draft.region) {
      throw new UserFacingError("This queue request expired. Please press Join Queue again.");
    }

    await interaction.deferUpdate();
    updateJoinQueueDraft({ guildId: interaction.guildId!, userId: interaction.user.id, flowId, gamemode });
    await interaction.editReply(await buildJoinQueueConfirmation({ flowId, guildId: interaction.guildId!, region: draft.region, gamemode }));
    return;
  }

  if (interaction.customId.startsWith("queue:cancel-join:")) {
    const flowId = expectCustomIdPart(interaction.customId, 2);
    getJoinQueueDraftForInteraction({ guildId: interaction.guildId!, userId: interaction.user.id, flowId });
    deleteJoinQueueDraft({ guildId: interaction.guildId!, userId: interaction.user.id, flowId });
    await interaction.update({ embeds: [createBaseEmbed().setTitle("Join Cancelled").setDescription("Queue join cancelled.")], components: [] });
    return;
  }

  if (interaction.customId.startsWith("queue:confirm:")) {
    const flowId = expectCustomIdPart(interaction.customId, 2);
    const draft = getJoinQueueDraftForInteraction({ guildId: interaction.guildId!, userId: interaction.user.id, flowId });

    if (!draft.region || !draft.gamemode) {
      throw new UserFacingError("This queue request expired. Please press Join Queue again.");
    }

    await interaction.deferUpdate();
    const member = (await interaction.guild.members.fetch(interaction.user.id)) as GuildMember;
    const joined = await joinQueueByWhitelistRole({ guild: interaction.guild, member, gamemode: draft.gamemode, region: draft.region, actorDiscordUserId: interaction.user.id });
    deleteJoinQueueDraft({ guildId: interaction.guildId!, userId: interaction.user.id, flowId });
    await interaction.editReply({ embeds: [buildQueueJoinedEmbed(joined)], components: [] });
    return;
  }

  await respondOutdatedPanel(interaction);
}

async function respondOutdatedPanel(interaction: ButtonInteraction | StringSelectMenuInteraction): Promise<void> {
  const message = "This queue panel is outdated. Please use the latest Snow Tier queue panel.";

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content: message, embeds: [], components: [] });
    return;
  }

  if (interaction.isButton()) {
    await interaction.reply({ content: message, ephemeral: true });
    return;
  }

  await interaction.update({ content: message, embeds: [], components: [] });
}

function expectCustomIdPart(customId: string, index: number): string {
  const value = customId.split(":")[index];

  if (!value) {
    throw new UserFacingError("Something went wrong while processing that queue interaction. Please press Join Queue again.");
  }

  return value;
}

function expectSelectedValue(values: string[]): string {
  const value = values[0];

  if (!value) {
    throw new UserFacingError("Something went wrong while processing that queue interaction. Please press Join Queue again.");
  }

  return value;
}
