import {
  TesterAvailability,
  TesterCertificationLevel,
  TesterRegion,
  TesterStatus
} from "@prisma/client";
import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember
} from "discord.js";
import type { SlashCommand } from "../types.js";
import { createInfoEmbed, createSuccessEmbed } from "../../utils/embeds.js";
import { UserFacingError } from "../../utils/errors.js";
import {
  addTester,
  certifyTester,
  getCertificationLevelForGamemode,
  getTesterCertificationHistory,
  getTesterProfile,
  listTesterGamemodeLabels,
  removeTester,
  requireTesterHistoryAccess,
  requireTesterManagementAccess,
  restoreTester,
  suspendTester,
  uncertifyTester,
  updateOwnTesterAvailability
} from "../../features/tester/service.js";

const gamemodeChoices = listTesterGamemodeLabels().map((gamemode) => ({ name: gamemode, value: gamemode }));
const certificationChoices = ["LOWER", "MIDDLE", "HIGHER"].map((level) => ({ name: level, value: level }));
const availabilityChoices = ["AVAILABLE", "BUSY", "OFFLINE"].map((status) => ({ name: status, value: status }));
const regionChoices = ["AS", "ME", "BOTH"].map((region) => ({ name: region, value: region }));

export const testerCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("tester")
    .setDescription("Manage Snow Tier testers.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("profile")
        .setDescription("Show a tester profile.")
        .addUserOption((option) => option.setName("user").setDescription("Optional tester to inspect."))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("availability")
        .setDescription("Update your tester availability.")
        .addStringOption((option) => option.setName("status").setDescription("Availability status.").setRequired(true).addChoices(...availabilityChoices))
        .addStringOption((option) => option.setName("region").setDescription("Region coverage.").setRequired(true).addChoices(...regionChoices))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("history")
        .setDescription("Show recent tester certification history.")
        .addUserOption((option) => option.setName("user").setDescription("Tester to inspect.").setRequired(true))
        .addStringOption((option) => option.setName("gamemode").setDescription("Optional gamemode filter.").addChoices(...gamemodeChoices))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("add")
        .setDescription("Add a tester.")
        .addUserOption((option) => option.setName("user").setDescription("Member to add.").setRequired(true))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remove")
        .setDescription("Disable a tester.")
        .addUserOption((option) => option.setName("user").setDescription("Tester to disable.").setRequired(true))
        .addStringOption((option) => option.setName("reason").setDescription("Reason.").setRequired(true).setMaxLength(500))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("suspend")
        .setDescription("Suspend a tester.")
        .addUserOption((option) => option.setName("user").setDescription("Tester to suspend.").setRequired(true))
        .addStringOption((option) => option.setName("reason").setDescription("Reason.").setRequired(true).setMaxLength(500))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("restore")
        .setDescription("Restore a tester.")
        .addUserOption((option) => option.setName("user").setDescription("Tester to restore.").setRequired(true))
        .addStringOption((option) => option.setName("reason").setDescription("Reason.").setRequired(true).setMaxLength(500))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("certify")
        .setDescription("Set a tester certification level.")
        .addUserOption((option) => option.setName("user").setDescription("Tester to certify.").setRequired(true))
        .addStringOption((option) => option.setName("gamemode").setDescription("Gamemode.").setRequired(true).addChoices(...gamemodeChoices))
        .addStringOption((option) => option.setName("level").setDescription("Certification level.").setRequired(true).addChoices(...certificationChoices))
        .addStringOption((option) => option.setName("reason").setDescription("Reason.").setRequired(true).setMaxLength(500))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("uncertify")
        .setDescription("Remove a tester certification.")
        .addUserOption((option) => option.setName("user").setDescription("Tester to update.").setRequired(true))
        .addStringOption((option) => option.setName("gamemode").setDescription("Gamemode.").setRequired(true).addChoices(...gamemodeChoices))
        .addStringOption((option) => option.setName("reason").setDescription("Reason.").setRequired(true).setMaxLength(500))
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) {
      throw new UserFacingError("This command can only be used inside a server.");
    }

    await interaction.deferReply({ ephemeral: true });
    const actingMember = (await interaction.guild.members.fetch(interaction.user.id)) as GuildMember;
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "availability") {
      await handleAvailability(interaction);
      return;
    }

    if (subcommand === "profile") {
      await handleProfile(interaction, actingMember);
      return;
    }

    if (subcommand === "history") {
      await handleHistory(interaction, actingMember);
      return;
    }

    await requireTesterManagementAccess(interaction.guildId!, actingMember);

    if (subcommand === "add") {
      await handleAdd(interaction);
      return;
    }

    if (subcommand === "remove") {
      await handleRemove(interaction);
      return;
    }

    if (subcommand === "suspend") {
      await handleSuspend(interaction);
      return;
    }

    if (subcommand === "restore") {
      await handleRestore(interaction);
      return;
    }

    if (subcommand === "certify") {
      await handleCertify(interaction);
      return;
    }

    await handleUncertify(interaction);
  }
};

async function handleProfile(interaction: ChatInputCommandInteraction, actingMember: GuildMember): Promise<void> {
  const targetUser = interaction.options.getUser("user") ?? interaction.user;

  if (targetUser.id !== interaction.user.id) {
    await requireTesterManagementAccess(interaction.guildId!, actingMember);
  }

  const { tester, gamemodes } = await getTesterProfile(interaction.guildId!, targetUser.id);

  if (!tester) {
    throw new UserFacingError(targetUser.id === interaction.user.id ? "You are not a Snow Tier tester." : "This member is not a Snow Tier tester.");
  }

  const certifications = gamemodes
    .map((gamemode) => `${gamemode.label.padEnd(11, " ")} ${getCertificationLevelForGamemode(tester, gamemode.label)}`)
    .join("\n");

  await interaction.editReply({
    embeds: [
      createInfoEmbed("SNOW TIER TESTER")
        .setDescription(`${targetUser.toString()}\n${formatStatus(tester.status)} • ${formatAvailability(tester.availability)} • ${tester.regionAvailability}`)
        .addFields({ name: "Certifications", value: `\`\`\`text\n${certifications}\n\`\`\`` })
    ]
  });
}

async function handleAvailability(interaction: ChatInputCommandInteraction): Promise<void> {
  const status = interaction.options.getString("status", true) as keyof typeof TesterAvailability;
  const region = interaction.options.getString("region", true) as keyof typeof TesterRegion;
  const tester = await updateOwnTesterAvailability({
    guildId: interaction.guildId!,
    discordUserId: interaction.user.id,
    status: TesterAvailability[status],
    region: TesterRegion[region]
  });

  await interaction.editReply({
    embeds: [
      createSuccessEmbed("TESTER UPDATED")
        .setDescription(`${formatAvailability(tester.availability)} • ${tester.regionAvailability}`)
    ]
  });
}

async function handleHistory(interaction: ChatInputCommandInteraction, actingMember: GuildMember): Promise<void> {
  const targetUser = interaction.options.getUser("user", true);
  const gamemode = interaction.options.getString("gamemode") ?? undefined;
  await requireTesterHistoryAccess(interaction.guildId!, actingMember, targetUser.id);

  const history = await getTesterCertificationHistory(interaction.guildId!, targetUser.id, gamemode);
  const description =
    history.length === 0
      ? "No tester certification history found."
      : history
          .map(
            (entry) =>
              `<t:${Math.floor(entry.createdAt.getTime() / 1000)}:f> | ${entry.gamemode.label} | ${entry.oldLevel} -> ${entry.newLevel} | By <@${entry.changedByDiscordUserId}> | ${entry.reason}`
          )
          .join("\n")
          .slice(0, 4000);

  await interaction.editReply({
    embeds: [createInfoEmbed(`TESTER HISTORY: ${targetUser.username}`, description)]
  });
}

async function handleAdd(interaction: ChatInputCommandInteraction): Promise<void> {
  const targetUser = interaction.options.getUser("user", true);
  const result = await addTester({ guild: interaction.guild!, targetUser, changedByDiscordUserId: interaction.user.id });

  await interaction.editReply({
    embeds: [
      createSuccessEmbed("TESTER UPDATED")
        .setDescription(`${targetUser.toString()}\nActive • Offline • BOTH`)
        .addFields({ name: "Role Sync", value: result.roleWarning ?? "Tester role synchronized." })
    ]
  });
}

async function handleRemove(interaction: ChatInputCommandInteraction): Promise<void> {
  const targetUser = interaction.options.getUser("user", true);
  const reason = interaction.options.getString("reason", true);
  const result = await removeTester({
    guild: interaction.guild!,
    targetUser,
    changedByDiscordUserId: interaction.user.id,
    reason
  });

  await interaction.editReply({
    embeds: [
      createSuccessEmbed("TESTER UPDATED")
        .setDescription(`${targetUser.toString()}\nDisabled • Offline`)
        .addFields({ name: "Reason", value: reason }, { name: "Role Sync", value: result.roleWarning ?? "Tester role synchronized." })
    ]
  });
}

async function handleSuspend(interaction: ChatInputCommandInteraction): Promise<void> {
  const targetUser = interaction.options.getUser("user", true);
  const reason = interaction.options.getString("reason", true);
  await suspendTester({ guildId: interaction.guildId!, targetUser, changedByDiscordUserId: interaction.user.id, reason });

  await interaction.editReply({
    embeds: [createSuccessEmbed("TESTER UPDATED", `${targetUser.toString()}\nSuspended • Offline`).addFields({ name: "Reason", value: reason })]
  });
}

async function handleRestore(interaction: ChatInputCommandInteraction): Promise<void> {
  const targetUser = interaction.options.getUser("user", true);
  const reason = interaction.options.getString("reason", true);
  const result = await restoreTester({
    guild: interaction.guild!,
    targetUser,
    changedByDiscordUserId: interaction.user.id,
    reason
  });

  await interaction.editReply({
    embeds: [
      createSuccessEmbed("TESTER UPDATED")
        .setDescription(`${targetUser.toString()}\nActive • Offline`)
        .addFields({ name: "Reason", value: reason }, { name: "Role Sync", value: result.roleWarning ?? "Tester role synchronized." })
    ]
  });
}

async function handleCertify(interaction: ChatInputCommandInteraction): Promise<void> {
  const targetUser = interaction.options.getUser("user", true);
  const gamemode = interaction.options.getString("gamemode", true);
  const level = interaction.options.getString("level", true) as "LOWER" | "MIDDLE" | "HIGHER";
  const reason = interaction.options.getString("reason", true);
  const result = await certifyTester({
    guildId: interaction.guildId!,
    targetUser,
    changedByDiscordUserId: interaction.user.id,
    gamemodeLabel: gamemode,
    level: TesterCertificationLevel[level],
    reason
  });

  await interaction.editReply({
    embeds: [
      createSuccessEmbed("TESTER UPDATED")
        .setDescription(`${targetUser.toString()}\n${gamemode} • ${result.oldLevel} -> ${result.newLevel}`)
        .addFields({ name: "Reason", value: reason })
    ]
  });
}

async function handleUncertify(interaction: ChatInputCommandInteraction): Promise<void> {
  const targetUser = interaction.options.getUser("user", true);
  const gamemode = interaction.options.getString("gamemode", true);
  const reason = interaction.options.getString("reason", true);
  const result = await uncertifyTester({
    guildId: interaction.guildId!,
    targetUser,
    changedByDiscordUserId: interaction.user.id,
    gamemodeLabel: gamemode,
    reason
  });

  await interaction.editReply({
    embeds: [
      createSuccessEmbed("TESTER UPDATED")
        .setDescription(`${targetUser.toString()}\n${gamemode} • ${result.oldLevel} -> NONE`)
        .addFields({ name: "Reason", value: reason })
    ]
  });
}

function formatStatus(status: TesterStatus): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function formatAvailability(status: TesterAvailability): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}
