import { commands } from "./commands/index.js";
import { createClient } from "./bot/client.js";
import { env } from "./config/env.js";
import { events } from "./bot/events/index.js";
import { prisma } from "./database/prisma.js";
import { logger } from "./utils/logger.js";
import { toError } from "./utils/errors.js";

async function bootstrap(): Promise<void> {
  const client = createClient();

  for (const command of commands) {
    client.commands.set(command.data.name, command);
  }

  for (const event of events) {
    const handler = (...args: unknown[]) => event.execute(client, ...(args as never));

    if (event.once) {
      client.once(event.name, handler);
    } else {
      client.on(event.name, handler);
    }
  }

  await prisma.$connect();
  logger.info("Connected to PostgreSQL via Prisma.");

  await client.login(env.DISCORD_TOKEN);

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    logger.info(`Received ${signal}. Shutting down.`);

    await client.destroy();
    await prisma.$disconnect();

    process.exit(0);
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

void bootstrap().catch(async (error) => {
  const resolvedError = toError(error);
  logger.error("Fatal startup error", resolvedError);

  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
