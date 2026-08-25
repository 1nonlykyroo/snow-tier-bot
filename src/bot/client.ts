import { Client, Collection, GatewayIntentBits, Partials } from "discord.js";
import { DEFAULT_PRESENCE } from "../config/constants.js";
import type { SlashCommand } from "../commands/types.js";

export interface SnowTierClient extends Client {
  commands: Collection<string, SlashCommand>;
}

export function createClient(): SnowTierClient {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
    partials: [Partials.Channel],
    presence: DEFAULT_PRESENCE
  }) as SnowTierClient;

  client.commands = new Collection<string, SlashCommand>();

  return client;
}
