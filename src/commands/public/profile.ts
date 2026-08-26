import { SlashCommandBuilder } from "discord.js";
import type { SlashCommand } from "../types.js";
import { createInfoEmbed } from "../../utils/embeds.js";
import { getProfile } from "../../features/tier/service.js";
import { UserFacingError } from "../../utils/errors.js";

export const profileCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("profile")
    .setDescription("Show a Snow Tier player profile.")
    .addUserOption((option) => option.setName("player").setDescription("Optional player to inspect.").setRequired(false)),
  async execute(interaction) {
    if (!interaction.inGuild()) {
      throw new UserFacingError("This command can only be used inside a server.");
    }

    await interaction.deferReply();

    const targetUser = interaction.options.getUser("player") ?? interaction.user;
    const profile = await getProfile(interaction.guildId!, targetUser.id);
    const tierByGamemode = new Map(profile.player?.tiers.map((entry) => [entry.gamemode.id, entry.tier.label]) ?? []);

    await interaction.editReply({
      embeds: [
        createInfoEmbed("SNOW TIER PROFILE")
          .addFields(
            { name: "Player", value: targetUser.toString(), inline: false },
            { name: "Region", value: "Not Set", inline: true },
            ...profile.gamemodes.map((gamemode) => ({
              name: gamemode.label,
              value: tierByGamemode.get(gamemode.id) ?? "Unranked",
              inline: true
            })),
            { name: "Tests Completed", value: "0", inline: true }
          )
      ]
    });
  }
};
