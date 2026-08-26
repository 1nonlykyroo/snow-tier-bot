import { EmbedBuilder } from "discord.js";
import { BOT_NAME, EMBED_COLOR } from "../config/constants.js";

export function createBaseEmbed(): EmbedBuilder {
  return new EmbedBuilder().setColor(EMBED_COLOR).setFooter({ text: BOT_NAME });
}

export function createSnowTierEmbed(title: string): EmbedBuilder {
  return createBaseEmbed().setTitle(title.startsWith("❄") ? title : `❄ ${title}`);
}

export function createInfoEmbed(title: string, description?: string): EmbedBuilder {
  const embed = createSnowTierEmbed(title);
  return description ? embed.setDescription(description) : embed;
}

export function createSuccessEmbed(title: string, description?: string): EmbedBuilder {
  return createInfoEmbed(title, description);
}

export function createErrorEmbed(title: string, description?: string): EmbedBuilder {
  return createInfoEmbed(title, description);
}
