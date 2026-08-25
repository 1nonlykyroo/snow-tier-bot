import { SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember } from "discord.js";
import type { SlashCommand } from "../types.js";
import { createBaseEmbed } from "../../utils/embeds.js";
import { UserFacingError } from "../../utils/errors.js";
import {
  GAMEMODE_DEFINITIONS,
  TIER_DEFINITIONS,
  formatTierRoleName
} from "../../features/foundation/tiers.js";
import {
  getPlayerTierHistory,
  removePlayerTier,
  requireTierStaffAccess,
  setPlayerTier
} from "../../features/tier/service.js";

const gamemodeChoices = GAMEMODE_DEFINITIONS.map((gamemode) => ({ name: gamemode.label, value: gamemode.label }));
const tierChoices = TIER_DEFINITIONS.map((tier) => ({ name: tier.label, value: tier.label }));

export const tierCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("tier")
    .setDescription("Manage player tiers.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("set")
        .setDescription("Set a player tier for one gamemode.")
        .addUserOption((option) => option.setName("player").setDescription("Player to update.").setRequired(true))
        .addStringOption((option) =>
          option.setName("gamemode").setDescription("Gamemode.").setRequired(true).addChoices(...gamemodeChoices)
        )
        .addStringOption((option) =>
          option.setName("tier").setDescription("Tier.").setRequired(true).addChoices(...tierChoices)
        )
        .addStringOption((option) => option.setName("reason").setDescription("Reason.").setRequired(true).setMaxLength(500))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("remove")
        .setDescription("Remove a player tier for one gamemode.")
        .addUserOption((option) => option.setName("player").setDescription("Player to update.").setRequired(true))
        .addStringOption((option) =>
          option.setName("gamemode").setDescription("Gamemode.").setRequired(true).addChoices(...gamemodeChoices)
        )
        .addStringOption((option) => option.setName("reason").setDescription("Reason.").setRequired(true).setMaxLength(500))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("history")
        .setDescription("Show recent player tier history.")
        .addUserOption((option) => option.setName("player").setDescription("Player to inspect.").setRequired(true))
        .addStringOption((option) =>
          option.setName("gamemode").setDescription("Optional gamemode filter.").addChoices(...gamemodeChoices)
        )
    ),
  async execute(interaction) {
    if (!interaction.inGuild() || !interaction.guild) {
      throw new UserFacingError("This command can only be used inside a server.");
    }

    await interaction.deferReply({ ephemeral: true });
    const actingMember = (await interaction.guild.members.fetch(interaction.user.id)) as GuildMember;
    await requireTierStaffAccess(interaction.guildId!, actingMember);

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "set") {
      await handleSet(interaction);
      return;
    }

    if (subcommand === "remove") {
      await handleRemove(interaction);
      return;
    }

    await handleHistory(interaction);
  }
};

async function handleSet(interaction: ChatInputCommandInteraction): Promise<void> {
  const player = interaction.options.getUser("player", true);
  const gamemode = interaction.options.getString("gamemode", true);
  const tier = interaction.options.getString("tier", true);
  const reason = interaction.options.getString("reason", true);

  const result = await setPlayerTier({
    guild: interaction.guild!,
    targetUser: player,
    changedByDiscordUserId: interaction.user.id,
    gamemodeLabel: gamemode,
    tierLabel: tier,
    reason
  });

  await interaction.editReply({
    embeds: [
      createBaseEmbed()
        .setTitle("Tier Updated")
        .setDescription(
          `${player.toString()} is now ${formatTierRoleName(gamemode, result.newTierLabel)} (previous: ${result.oldTierLabel ?? "Unranked"}).`
        )
        .addFields(
          { name: "Reason", value: reason },
          ...(result.testingQueueCleanupWarning ? [{ name: "Queue Cleanup", value: result.testingQueueCleanupWarning }] : [])
        )
    ]
  });
}

async function handleRemove(interaction: ChatInputCommandInteraction): Promise<void> {
  const player = interaction.options.getUser("player", true);
  const gamemode = interaction.options.getString("gamemode", true);
  const reason = interaction.options.getString("reason", true);

  const result = await removePlayerTier({
    guild: interaction.guild!,
    targetUser: player,
    changedByDiscordUserId: interaction.user.id,
    gamemodeLabel: gamemode,
    reason
  });

  await interaction.editReply({
    embeds: [
      createBaseEmbed()
        .setTitle("Tier Removed")
        .setDescription(`${player.toString()} is now unranked in ${gamemode}. Removed ${result.removedTierLabel}.`)
        .addFields({ name: "Reason", value: reason })
    ]
  });
}

async function handleHistory(interaction: ChatInputCommandInteraction): Promise<void> {
  const player = interaction.options.getUser("player", true);
  const gamemode = interaction.options.getString("gamemode") ?? undefined;
  const history = await getPlayerTierHistory(interaction.guildId!, player.id, gamemode);

  const description =
    history.length === 0
      ? "No tier history found for that player."
      : history
          .map(
            (entry: (typeof history)[number]) =>
              `<t:${Math.floor(entry.createdAt.getTime() / 1000)}:f> | ${entry.gamemode.label} | ${entry.oldTier?.label ?? "Unranked"} -> ${entry.newTier?.label ?? "Unranked"} | By <@${entry.changedByDiscordUserId}> | ${entry.reason}`
          )
          .join("\n")
          .slice(0, 4000);

  await interaction.editReply({
    embeds: [
      createBaseEmbed()
        .setTitle(`Tier History: ${player.username}`)
        .setDescription(description)
    ]
  });
}
