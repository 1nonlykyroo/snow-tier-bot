import { SlashCommandBuilder } from "discord.js";
import type { SlashCommand } from "../types.js";
import { createBaseEmbed } from "../../utils/embeds.js";

export const pingCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check bot and API latency."),
  async execute(interaction) {
    const wsPing = interaction.client.ws.ping;
    const sentAt = Date.now();

    await interaction.reply({
      embeds: [
        createBaseEmbed()
          .setTitle("❄ Snow Tier Ping")
          .addFields(
            { name: "Gateway", value: `${wsPing}ms`, inline: true },
            { name: "Response", value: `${Date.now() - sentAt}ms`, inline: true }
          )
          .setTimestamp()
      ],
      ephemeral: true
    });
  }
};
