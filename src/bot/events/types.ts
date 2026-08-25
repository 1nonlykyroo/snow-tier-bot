import type { ClientEvents } from "discord.js";
import type { SnowTierClient } from "../client.js";

export interface BotEvent<K extends keyof ClientEvents> {
  name: K;
  once?: boolean;
  execute(client: SnowTierClient, ...args: ClientEvents[K]): Promise<void> | void;
}
