import { PrismaClient } from "@prisma/client";

declare global {
  var __snowTierPrisma__: PrismaClient | undefined;
}

export const prisma =
  globalThis.__snowTierPrisma__ ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"]
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__snowTierPrisma__ = prisma;
}
