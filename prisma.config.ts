import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Prisma 7 configuration.
 *
 * ---------------------------------------------------------------------------
 * Why there are two database URLs
 * ---------------------------------------------------------------------------
 * Neon gives you two endpoints for the same database:
 *
 *   DATABASE_URL  → ...-pooler.c-4...  Goes through PgBouncer. Hands out
 *                                      connections from a shared pool. This is
 *                                      what the running app must use: serverless
 *                                      functions open and close connections
 *                                      constantly, and without a pool we would
 *                                      exhaust Neon's connection limit.
 *
 *   DIRECT_URL    → ...c-4...          A real connection straight to Postgres.
 *                                      Migrations need this. A migration issues
 *                                      DDL and holds advisory locks across
 *                                      statements; PgBouncer in transaction mode
 *                                      can hand each statement to a DIFFERENT
 *                                      backend, so the lock is taken on one
 *                                      connection and the next statement lands
 *                                      somewhere else. That fails in confusing,
 *                                      intermittent ways.
 *
 * So: pooled for the app (src/lib/prisma.ts), direct for the CLI (this file).
 *
 * ---------------------------------------------------------------------------
 * Why `process.env` and not Prisma's `env()` helper
 * ---------------------------------------------------------------------------
 * `env()` throws the instant a variable is missing. This file is loaded by
 * `prisma generate`, which runs inside our Vercel build — and generating the
 * client needs no database at all. A missing URL must never be able to fail the
 * build and take the live site down. Commands that genuinely need a database
 * fail on their own, with a clearer message.
 *
 * The `?? DATABASE_URL` fallback means migrations still work if DIRECT_URL was
 * never set — degraded, but not broken.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // Prisma 7 no longer seeds automatically after `migrate dev`.
    // Seeding is an explicit `npm run db:seed`.
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
});
