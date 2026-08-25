import type { BotEvent } from "./types.js";
import { interactionCreateEvent } from "./interactionCreate.js";
import { readyEvent } from "./ready.js";

export const events: BotEvent<keyof import("discord.js").ClientEvents>[] = [
  readyEvent,
  interactionCreateEvent
];
