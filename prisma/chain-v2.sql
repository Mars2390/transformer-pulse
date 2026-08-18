-- Chain v2: the hashVersion column, and RESTRICT on the five audit-bearing tables.
--
-- This repository has no prisma/migrations directory — the schema is applied with
-- `npm run db:push`, and db push will make both of these changes on its own. This
-- file exists for the case db push is not the right tool: a production database
-- where the DDL wants reading before it is run, and a DBA who will run it by hand.
-- It matches prisma/schema.prisma exactly and is safe to run twice.
--
--
-- 1. hashVersion, DEFAULT 1 AND NOTHING ELSE
--
-- Every row already in this table was hashed with the ten-element v1 canonical
-- form. The default is 1 so those rows keep verifying exactly as they always did,
-- and computeEventHash() stamps 2 on rows written from now on.
--
-- DO NOT BACKFILL THIS COLUMN TO 2. There is no way to recompute a v2 hash for an
-- old row without rewriting the hash itself, and a chain whose hashes have been
-- rewritten is exactly what the chain exists to detect. An UPDATE to 2 turns every
-- verified badge in the register red on data nobody touched.
--
-- ADD COLUMN is DDL, so the lifecycleevent_immutable trigger from
-- security-hardening.sql does not fire on it. That trigger refuses row UPDATE and
-- DELETE, which is also why the backfill above is not merely unwise but blocked.

ALTER TABLE "LifecycleEvent"
  ADD COLUMN IF NOT EXISTS "hashVersion" INTEGER NOT NULL DEFAULT 1;


-- 2. RESTRICT instead of CASCADE on everything that is testimony.
--
-- These five tables all hang off Transformer and all recorded something a person
-- did. With CASCADE, one DELETE on Transformer removed the transformer AND every
-- event, test, approval, claim and repair that proved it existed — no rows left to
-- fail verification, which is the one failure the chain is built to make visible.
--
-- With RESTRICT, a transformer that has any history cannot be deleted at all. That
-- is the intended outcome: a unit is RETIRED, never deleted. Alert and
-- RecordConflict deliberately keep CASCADE — they are derived operational rows,
-- not testimony, and they are not listed here.
--
-- ON UPDATE CASCADE is kept because that is what Prisma generates for a required
-- relation; changing it would make the next db push want to change it back.

ALTER TABLE "ApprovalDocument"
  DROP CONSTRAINT IF EXISTS "ApprovalDocument_transformerId_fkey";
ALTER TABLE "ApprovalDocument"
  ADD CONSTRAINT "ApprovalDocument_transformerId_fkey"
  FOREIGN KEY ("transformerId") REFERENCES "Transformer"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LifecycleEvent"
  DROP CONSTRAINT IF EXISTS "LifecycleEvent_transformerId_fkey";
ALTER TABLE "LifecycleEvent"
  ADD CONSTRAINT "LifecycleEvent_transformerId_fkey"
  FOREIGN KEY ("transformerId") REFERENCES "Transformer"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TestRecord"
  DROP CONSTRAINT IF EXISTS "TestRecord_transformerId_fkey";
ALTER TABLE "TestRecord"
  ADD CONSTRAINT "TestRecord_transformerId_fkey"
  FOREIGN KEY ("transformerId") REFERENCES "Transformer"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WarrantyClaim"
  DROP CONSTRAINT IF EXISTS "WarrantyClaim_transformerId_fkey";
ALTER TABLE "WarrantyClaim"
  ADD CONSTRAINT "WarrantyClaim_transformerId_fkey"
  FOREIGN KEY ("transformerId") REFERENCES "Transformer"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RepairRecord"
  DROP CONSTRAINT IF EXISTS "RepairRecord_transformerId_fkey";
ALTER TABLE "RepairRecord"
  ADD CONSTRAINT "RepairRecord_transformerId_fkey"
  FOREIGN KEY ("transformerId") REFERENCES "Transformer"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Proving it worked:
--
--   SELECT "hashVersion", count(*) FROM "LifecycleEvent" GROUP BY 1;
--     -> every existing row 1, and 2 only on rows written after this ran
--
--   DELETE FROM "Transformer" WHERE id = (SELECT "transformerId" FROM "LifecycleEvent" LIMIT 1);
--     -> must fail with "violates foreign key constraint". If it succeeds, the
--        constraints above did not apply and the chain is not protected.
