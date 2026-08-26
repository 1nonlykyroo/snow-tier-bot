import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction
} from "discord.js";
import type { SlashCommand } from "../types.js";
import { createInfoEmbed, createSuccessEmbed } from "../../utils/embeds.js";
import { UserFacingError } from "../../utils/errors.js";
import {
  QUEUE_REGIONS,
  GAMEMODE_DEFINITIONS,
  TIER_DEFINITIONS,
  formatTierRoleName
} from "../../features/foundation/tiers.js";
import {
  createOrMapAllWhitelistRoles,
  createOrMapAllTierRoles,
  ensureStaticDefinitions,
  getSetupOverview,
  mapQueueChannel,
  mapTierRole,
  updateQueueChannelPermissions,
  updateGuildChannelConfig,
  updateGuildRoleConfig
} from "../../features/setup/service.js";

const gamemodeChoices = GAMEMODE_DEFINITIONS.map((gamemode) => ({ name: gamemode.label, value: gamemode.label }));
const tierChoices = TIER_DEFINITIONS.map((tier) => ({ name: tier.label, value: tier.label }));
const queueRegionChoices = QUEUE_REGIONS.map((region) => ({ name: region, value: region }));

export const setupCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Configure Snow Tier Phase 2 server settings.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("channel")
        .setDescription("Store a configured channel or category.")
        .addStringOption((option) =>
          option
            .setName("target")
            .setDescription("Which setup channel field to configure.")
            .setRequired(true)
            .addChoices(
              { name: "Queue channel", value: "queue_channel" },
              { name: "Results channel", value: "results_channel" },
              { name: "Logs channel", value: "logs_channel" },
              { name: "Review channel", value: "review_channel" },
              { name: "Test category", value: "test_category" }
            )
        )
        .addChannelOption((option) =>
          option
            .setName("value")
            .setDescription("Channel or category to store.")
            .setRequired(true)
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
              ChannelType.GuildForum,
              ChannelType.GuildCategory
            )
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("staff-role")
        .setDescription("Store a configured staff role.")
        .addStringOption((option) =>
          option
            .setName("target")
            .setDescription("Which staff role field to configure.")
            .setRequired(true)
            .addChoices(
              { name: "Owner role", value: "owner_role" },
              { name: "Administrator role", value: "administrator_role" },
              { name: "Tier Manager role", value: "tier_manager_role" },
              { name: "Head Tester role", value: "head_tester_role" },
              { name: "Senior Tester role", value: "senior_tester_role" },
              { name: "Tester role", value: "tester_role" },
              { name: "Trial Tester role", value: "trial_tester_role" }
            )
        )
        .addRoleOption((option) =>
          option.setName("value").setDescription("Role to store.").setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("tier-role")
        .setDescription("Map one gamemode and tier combination to a Discord role.")
        .addStringOption((option) =>
          option.setName("gamemode").setDescription("Gamemode name.").setRequired(true).addChoices(...gamemodeChoices)
        )
        .addStringOption((option) =>
          option.setName("tier").setDescription("Tier name.").setRequired(true).addChoices(...tierChoices)
        )
        .addRoleOption((option) =>
          option.setName("role").setDescription("Role to map for this gamemode/tier.").setRequired(true)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("sync-tier-roles")
        .setDescription("Create missing tier roles and map all 90 combinations safely.")
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("sync-whitelist-roles").setDescription("Create missing whitelist roles and map all 18 queue combinations safely.")
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("queue-channel")
        .setDescription("Map one gamemode and region queue channel.")
        .addStringOption((option) => option.setName("gamemode").setDescription("Gamemode name.").setRequired(true).addChoices(...gamemodeChoices))
        .addStringOption((option) => option.setName("region").setDescription("Region.").setRequired(true).addChoices(...queueRegionChoices))
        .addChannelOption((option) => option.setName("channel").setDescription("Queue channel.").setRequired(true).addChannelTypes(ChannelType.GuildText))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("queue-permissions")
        .setDescription("Apply safe queue channel permission overwrites for one whitelist queue.")
        .addStringOption((option) => option.setName("gamemode").setDescription("Gamemode name.").setRequired(true).addChoices(...gamemodeChoices))
        .addStringOption((option) => option.setName("region").setDescription("Region.").setRequired(true).addChoices(...queueRegionChoices))
    )
    .addSubcommand((subcommand) =>
      subcommand.setName("overview").setDescription("Show stored setup configuration and tier role coverage.")
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) {
      throw new UserFacingError("This command can only be used inside a server.");
    }

    await interaction.deferReply({ ephemeral: true });

    await ensureStaticDefinitions();

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "channel") {
      await handleChannelSetup(interaction);
      return;
    }

    if (subcommand === "staff-role") {
      await handleStaffRoleSetup(interaction);
      return;
    }

    if (subcommand === "tier-role") {
      await handleTierRoleSetup(interaction);
      return;
    }

    if (subcommand === "sync-tier-roles") {
      await handleTierRoleSync(interaction);
      return;
    }

    if (subcommand === "sync-whitelist-roles") {
      await handleWhitelistRoleSync(interaction);
      return;
    }

    if (subcommand === "queue-channel") {
      await handleQueueChannelSetup(interaction);
      return;
    }

    if (subcommand === "queue-permissions") {
      await handleQueuePermissionsSetup(interaction);
      return;
    }

    await handleOverview(interaction);
  }
};

async function handleChannelSetup(interaction: ChatInputCommandInteraction): Promise<void> {
  const target = interaction.options.getString("target", true) as
    | "queue_channel"
    | "results_channel"
    | "logs_channel"
    | "review_channel"
    | "test_category";
  const channel = interaction.options.getChannel("value", true);

  if (target === "test_category" && channel.type !== ChannelType.GuildCategory) {
    throw new UserFacingError("Test category must be a server category.");
  }

  if (target !== "test_category" && channel.type === ChannelType.GuildCategory) {
    throw new UserFacingError("That setup target requires a channel, not a category.");
  }

  await updateGuildChannelConfig(interaction.guildId!, target, channel.id);

  await interaction.editReply({
    embeds: [
      createSuccessEmbed("SETUP UPDATED")
        .setDescription(`Stored ${channel.toString()} for \`${target}\`.`)
    ]
  });
}

async function handleStaffRoleSetup(interaction: ChatInputCommandInteraction): Promise<void> {
  const target = interaction.options.getString("target", true) as
    | "owner_role"
    | "administrator_role"
    | "tier_manager_role"
    | "head_tester_role"
    | "senior_tester_role"
    | "tester_role"
    | "trial_tester_role";
  const role = interaction.options.getRole("value", true);

  await updateGuildRoleConfig(interaction.guildId!, target, role.id);

  await interaction.editReply({
    embeds: [
      createSuccessEmbed("SETUP UPDATED")
        .setDescription(`Stored ${role.toString()} for \`${target}\`.`)
    ]
  });
}

async function handleTierRoleSetup(interaction: ChatInputCommandInteraction): Promise<void> {
  const gamemode = interaction.options.getString("gamemode", true);
  const tier = interaction.options.getString("tier", true);
  const role = interaction.options.getRole("role", true);

  await mapTierRole(interaction.guildId!, role.id, gamemode, tier);

  await interaction.editReply({
    embeds: [
      createSuccessEmbed("SETUP UPDATED")
        .setDescription(`Mapped ${role.toString()} to \`${formatTierRoleName(gamemode, tier)}\`.`)
    ]
  });
}

async function handleTierRoleSync(interaction: ChatInputCommandInteraction): Promise<void> {
  const result = await createOrMapAllTierRoles(interaction.guild!);

  await interaction.editReply({
    embeds: [
      createSuccessEmbed("SETUP UPDATED")
        .setDescription(
          [
            `Created: ${result.created.length}`,
            `Mapped existing: ${result.mapped.length}`,
            `Total covered: ${result.created.length + result.mapped.length}/90`
          ].join("\n")
        )
    ]
  });
}

async function handleOverview(interaction: ChatInputCommandInteraction): Promise<void> {
  const overview = await getSetupOverview(interaction.guildId!);

  await interaction.editReply({
    embeds: [
      createInfoEmbed("SETUP OVERVIEW")
        .addFields(
          { name: "Queue Panel Channel", value: formatChannelMention(overview.queueChannelId), inline: true },
          { name: "Results channel", value: formatChannelMention(overview.resultsChannelId), inline: true },
          { name: "Logs channel", value: formatChannelMention(overview.logsChannelId), inline: true },
          { name: "Review channel", value: formatChannelMention(overview.reviewChannelId), inline: true },
          { name: "Test Category", value: formatChannelMention(overview.testCategoryId), inline: true },
          { name: "Tier Roles", value: `${overview.tierRoles}/90`, inline: true },
          { name: "Whitelist Roles", value: `${overview.whitelistRoles}/18`, inline: true },
          { name: "Queue Channels", value: `${overview.queueChannels}/18`, inline: true },
          { name: "Owner role", value: formatRoleMention(overview.ownerRoleId), inline: true },
          { name: "Administrator role", value: formatRoleMention(overview.administratorRoleId), inline: true },
          { name: "Tier Manager role", value: formatRoleMention(overview.tierManagerRoleId), inline: true },
          { name: "Head Tester role", value: formatRoleMention(overview.headTesterRoleId), inline: true },
          { name: "Senior Tester role", value: formatRoleMention(overview.seniorTesterRoleId), inline: true },
          { name: "Tester role", value: formatRoleMention(overview.testerRoleId), inline: true },
          { name: "Trial Tester role", value: formatRoleMention(overview.trialTesterRoleId), inline: true }
        )
    ]
  });
}

async function handleWhitelistRoleSync(interaction: ChatInputCommandInteraction): Promise<void> {
  const result = await createOrMapAllWhitelistRoles(interaction.guild!);

  await interaction.editReply({
    embeds: [
      createSuccessEmbed("SETUP UPDATED")
        .setDescription([`Created: ${result.created.length}`, `Mapped existing: ${result.mapped.length}`, `Failed: ${result.failed.length}`, `${result.created.length + result.mapped.length}/18`].join("\n"))
    ]
  });
}

async function handleQueueChannelSetup(interaction: ChatInputCommandInteraction): Promise<void> {
  const gamemode = interaction.options.getString("gamemode", true);
  const region = interaction.options.getString("region", true) as (typeof QUEUE_REGIONS)[number];
  const channel = interaction.options.getChannel("channel", true);

  await mapQueueChannel(interaction.guildId!, gamemode, region, channel.id, interaction.user.id);

  await interaction.editReply({
    embeds: [createSuccessEmbed("SETUP UPDATED", `${gamemode} • ${region}\n${channel.toString()}`)]
  });
}

async function handleQueuePermissionsSetup(interaction: ChatInputCommandInteraction): Promise<void> {
  const gamemode = interaction.options.getString("gamemode", true);
  const region = interaction.options.getString("region", true) as (typeof QUEUE_REGIONS)[number];

  await updateQueueChannelPermissions({ guild: interaction.guild!, gamemodeLabel: gamemode, region });

  await interaction.editReply({
    embeds: [createSuccessEmbed("SETUP UPDATED", `${gamemode} • ${region}`)]
  });
}

function formatChannelMention(value: string | null): string {
  return value ? `<#${value}>` : "Not set";
}

function formatRoleMention(value: string | null): string {
  return value ? `<@&${value}>` : "Not set";
}
