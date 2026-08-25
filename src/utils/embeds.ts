import { EmbedBuilder } from "discord.js";
import { BOT_NAME, EMBED_COLOR } from "../config/constants.js";

export function createBaseEmbed(): EmbedBuilder {
  return new EmbedBuilder().setColor(EMBED_COLOR).setFooter({ text: BOT_NAME });
}
