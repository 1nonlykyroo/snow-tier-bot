import type { BotEvent } from "./types.js";
import { logger } from "../../utils/logger.js";

export const readyEvent: BotEvent<"clientReady"> = {
  name: "clientReady",
  once: true,
  execute(client) {
    logger.info(`Logged in as ${client.user?.tag ?? "unknown-user"}`);
  }
};
