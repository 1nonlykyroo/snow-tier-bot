import { ActivityType, ColorResolvable } from "discord.js";

export const BOT_NAME = "Snow Tier";
export const EMBED_COLOR: ColorResolvable = 0xe7f3ff;

export const DEFAULT_PRESENCE = {
  activities: [{ name: "Snow Tier Tests ❄", type: ActivityType.Watching }],
  status: "online" as const
};
