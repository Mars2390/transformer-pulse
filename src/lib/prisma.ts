import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * The database client.
 *
 * Two Prisma 7 details worth understanding:
 *
 * 1. The client is imported from `src/generated/prisma`, NOT from
 *    "@prisma/client". Prisma 7 no longer writes the client into node_modules.
 *
 * 2. A driver adapter is now mandatory. `PrismaPg` is the PostgreSQL adapter;
 *    `new PrismaClient()` with no adapter throws.
 *
 * The global cache exists because Next.js hot-reloads modules on every save in
 * development. Without it we would open a new connection pool per save and
 * exhaust Neon's connection limit within minutes.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Add the Neon integration in your Vercel project (Storage → Create → Neon), then run `vercel env pull .env` to get it locally.",
    );
  }

  const adapter = new PrismaPg({ connectionString });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
