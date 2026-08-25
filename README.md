# Snow Tier

Snow Tier is a production-oriented Discord bot foundation for Minecraft tier testing. This repository currently contains Phase 1 only: the TypeScript, Discord, Prisma, environment, command, and deployment foundation.

## Current Phase

Implemented in Phase 1:

- Node.js + TypeScript project setup
- `discord.js` v14 client bootstrap
- Zod environment validation
- Prisma PostgreSQL connection setup
- Modular event and slash command loading
- `/ping` command
- Centralized error handling
- Graceful shutdown for `SIGINT` and `SIGTERM`
- Guild command deployment script
- Railway-compatible scripts and documentation

Not implemented yet:

- Queue system
- Tier system
- Tester system
- Reviews
- Cooldowns
- Setup/config persistence

## Requirements

- Node.js 20+
- PostgreSQL database
- Discord application and bot token

## Environment Variables

Create a local `.env` file from `.env.example`.

```env
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
DATABASE_URL=
```

## Discord Developer Portal Setup

1. Create a new application in the Discord Developer Portal.
2. Add a bot user.
3. Copy the bot token into `DISCORD_TOKEN`.
4. Copy the application ID into `DISCORD_CLIENT_ID`.
5. Enable the `applications.commands` scope when inviting the bot.
6. Invite the bot to your development server and set `DISCORD_GUILD_ID` to that server ID.

## PostgreSQL Setup

1. Create a PostgreSQL database.
2. Copy the connection string into `DATABASE_URL`.
3. Run Prisma client generation:

```bash
npm run prisma:generate
```

Later phases will add actual Prisma models and migrations.

## Local Setup

```bash
npm install
npm run prisma:generate
npm run typecheck
npm run build
```

## Slash Command Deployment

Deploy guild commands during development:

```bash
npm run deploy:commands
```

This currently registers `/ping` to the guild set in `DISCORD_GUILD_ID`.

## Local Development

```bash
npm run dev
```

Production build:

```bash
npm run build
npm run start
```

## Railway Deployment

Recommended Railway flow:

1. Connect the GitHub repository to Railway.
2. Provision PostgreSQL in Railway.
3. Set the environment variables from `.env.example`.
4. Use this build command:

```bash
npm install && npm run prisma:generate && npm run build
```

5. Use this start command:

```bash
npm run start
```

For production migrations later, prefer an explicit release step rather than running `prisma migrate dev` during every deploy.

## Troubleshooting

- If startup fails immediately, check the required environment variables.
- If `/ping` does not appear, run `npm run deploy:commands` again.
- If Prisma generation fails, verify `DATABASE_URL` points to a reachable PostgreSQL instance.
- If login fails, verify the bot token and bot invite scopes.

## Project Structure

```text
snow-tier-bot/
├── prisma/
├── scripts/
├── src/
│   ├── bot/
│   ├── commands/
│   ├── config/
│   ├── database/
│   └── utils/
├── .env.example
├── .gitignore
├── package.json
└── tsconfig.json
```
