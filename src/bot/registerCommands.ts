import { commands } from "../commands/index.js";
import type { SlashCommandJson } from "../commands/types.js";

export function getCommandPayload(): SlashCommandJson[] {
  return commands.map((command) => command.data.toJSON());
}
