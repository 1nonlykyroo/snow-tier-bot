import dotenv from "dotenv";
import { REST, Routes } from "discord.js";
import { z } from "zod";
import { getCommandPayload } from "../src/bot/registerCommands.js";

dotenv.config();

const deployEnvSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1)
});

const parsed = deployEnvSchema.parse(process.env);

async function deployCommands(): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(parsed.DISCORD_TOKEN);
  const payload = getCommandPayload();

  await rest.put(Routes.applicationGuildCommands(parsed.DISCORD_CLIENT_ID, parsed.DISCORD_GUILD_ID), {
    body: payload
  });

  console.log(`Deployed ${payload.length} guild command(s).`);
}

void deployCommands();
