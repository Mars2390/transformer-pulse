import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * The database client.
 *
 * ---------------------------------------------------------------------------
 * Why this is lazy
 * ---------------------------------------------------------------------------
 * `next build` imports every route module to collect page data. If we created
 * the client at module scope, that import would try to read DATABASE_URL and
 * throw — failing the BUILD, not just the request. A build should never need a
 * database: it compiles code, it does not query anything.
 *
 * So `prisma` is a Proxy. Importing it costs nothing. The real client is
 * constructed on the first property access — i.e. the first actual query, at
 * runtime, when the environment variable genuinely must exist.
 *
 * ---------------------------------------------------------------------------
 * Prisma 7 details
 * ---------------------------------------------------------------------------
 * - The client comes from `src/generated/prisma`, never "@prisma/client".
 * - A driver adapter is mandatory; `new PrismaClient()` alone throws.
 * - We use the POOLED url (DATABASE_URL). Serverless functions open and close
 *   connections constantly, and without PgBouncer we exhaust Neon's limit.
 *   DIRECT_URL is for migrations only — see prisma.config.ts.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set.\n" +
        "  Local:      run `npx vercel env pull .env`\n" +
        "  Production: Vercel → Project → Settings → Environment Variables →\n" +
        "              add DATABASE_URL (the Neon POOLED url), then redeploy.",
    );
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

function getClient(): PrismaClient {
  // The global cache exists because Next.js hot-reloads modules on every save.
  // Without it we would open a new pool per save and exhaust Neon in minutes.
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createClient();
  }
  return globalForPrisma.prisma;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const client = getClient();
    const value = Reflect.get(client, property, client);
    // Methods like $transaction need `this` bound to the real client, or they
    // lose their internals the moment they are pulled off the Proxy.
    return typeof value === "function" ? value.bind(client) : value;
  },
});
