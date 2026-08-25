import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN is required."),
  DISCORD_CLIENT_ID: z.string().min(1, "DISCORD_CLIENT_ID is required."),
  DISCORD_GUILD_ID: z.string().min(1, "DISCORD_GUILD_ID is required."),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required.")
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const message = parsedEnv.error.issues
    .map((issue) => `- ${issue.message}`)
    .join("\n");

  throw new Error(`Invalid environment configuration:\n${message}`);
}

export const env = parsedEnv.data;
