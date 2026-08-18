import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

/**
 * Applies the database-level security hardening. Run with:
 *
 *   npx tsx scripts/apply-security-hardening.mts
 *
 * No psql required — it uses the pg driver this project already depends on.
 *
 * WHY THIS MATTERS ON NEON
 *
 * Neon gives you a single role and that role OWNS every table. PostgreSQL does
 * not apply table privileges to a table's owner, so `REVOKE UPDATE, DELETE`
 * against it is accepted and then ignored: the owner keeps writing. A
 * hardening file made only of REVOKEs would run without error, report success,
 * and change nothing — which is worse than not running it, because you would
 * believe the audit trail was immutable.
 *
 * The TRIGGERS are therefore the real control here. A BEFORE UPDATE OR DELETE
 * trigger that raises an exception applies to everybody including the owner,
 * so it holds on Neon as it stands today. The REVOKEs are still issued for the
 * case where KPLC later moves the application onto its own non-owner role,
 * and they are skipped quietly when that role does not exist.
 */

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.error("Set DATABASE_URL (and ideally DIRECT_URL) in .env first.");
  process.exit(1);
}

// Migrations and DDL go over the DIRECT connection. Neon's pooled endpoint
// runs PgBouncer in transaction mode, which can hand consecutive statements to
// different backends — fine for queries, not for CREATE FUNCTION / CREATE
// TRIGGER pairs that expect to see each other.
if (!process.env.DIRECT_URL) {
  console.warn("DIRECT_URL is not set; falling back to DATABASE_URL. If that is the -pooler host, set DIRECT_URL to the non-pooled one.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/**
 * The append-only tables, each with the columns that may still be filled in
 * after the row is written. Everything not listed is frozen at insert.
 */
const APPEND_ONLY = [
  { table: "SecurityEvent", fillable: ["location", "country", "city", "isp"], frozenColumn: "path" },
  { table: "AuditLog", fillable: [] as string[], frozenColumn: "action" },
  { table: "LifecycleEvent", fillable: ["linkedEventId"], frozenColumn: "hash" },
] as const;
const APP_ROLE = process.env.APP_DB_ROLE ?? "transformer_app";

/**
 * Append-only, but not blindly so.
 *
 * A trigger that refuses every UPDATE looks stronger and is actually wrong
 * here, because two legitimate writes touch these tables after insert:
 *
 *   LifecycleEvent.linkedEventId — the replace flow closes the cross-reference
 *   both ways so the old unit's story says "replaced by ...". It is explicitly
 *   not part of the chain hash.
 *
 *   SecurityEvent location/country/city/isp — geolocation is resolved after
 *   the event is written, precisely so a third-party lookup never sits inside
 *   the sign-in path.
 *
 * Blocking those would have broken transformer replacement and the security
 * dashboard's own map. So each table names the columns that may be filled in
 * later, and the trigger enforces two things about them: nothing else in the
 * row may change, and an allowed column may only go from NULL to a value —
 * once set it is frozen like everything else. DELETE is refused outright.
 *
 * The row comparison is done on jsonb with the allowed keys removed, so it
 * covers every column including ones added by a future migration. A
 * hand-written list of columns to compare would silently stop protecting
 * whatever was added next.
 */
const REFUSE_FN = `
CREATE OR REPLACE FUNCTION refuse_mutation() RETURNS trigger AS $BODY$
DECLARE
  allowed text[] := COALESCE(TG_ARGV[0], '{}')::text[];
  old_rest jsonb;
  new_rest jsonb;
  col text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Table % is append-only. Rows may not be deleted.', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;

  old_rest := to_jsonb(OLD);
  new_rest := to_jsonb(NEW);

  FOREACH col IN ARRAY allowed LOOP
    IF (old_rest -> col) IS DISTINCT FROM (new_rest -> col)
       AND jsonb_typeof(old_rest -> col) <> 'null' THEN
      RAISE EXCEPTION 'Table % is append-only. Column "%" was already set and may not be changed.',
        TG_TABLE_NAME, col USING ERRCODE = 'check_violation';
    END IF;
    old_rest := old_rest - col;
    new_rest := new_rest - col;
  END LOOP;

  IF old_rest IS DISTINCT FROM new_rest THEN
    RAISE EXCEPTION 'Table % is append-only. Only these columns may be filled in after insert: %.',
      TG_TABLE_NAME, COALESCE(array_to_string(allowed, ', '), 'none')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$BODY$ LANGUAGE plpgsql;
`;

async function run(label: string, sql: string, optional = false): Promise<boolean> {
  try {
    await prisma.$executeRawUnsafe(sql);
    console.log(`  ok    ${label}`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (optional) {
      console.log(`  skip  ${label} — ${message.split("\n")[0].slice(0, 90)}`);
      return false;
    }
    console.error(`  FAIL  ${label}`);
    throw error;
  }
}

async function main() {
  const [{ current_user: role, current_database: db }] = await prisma.$queryRawUnsafe<
    { current_user: string; current_database: string }[]
  >("SELECT current_user, current_database()");
  console.log(`Connected to ${db} as ${role}\n`);

  const owners = await prisma.$queryRawUnsafe<{ tablename: string; tableowner: string }[]>(
    `SELECT tablename, tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1)`,
    APPEND_ONLY.map((t) => t.table),
  );
  const ownsEverything = owners.every((t) => t.tableowner === role);

  console.log("1. Append-only triggers (the control that works regardless of ownership)");
  await run("refuse_mutation() function", REFUSE_FN);
  for (const { table, fillable } of APPEND_ONLY) {
    const trigger = `${table.toLowerCase()}_immutable`;
    const arg = `{${fillable.join(",")}}`;
    await run(`drop existing trigger on ${table}`, `DROP TRIGGER IF EXISTS ${trigger} ON "${table}"`);
    await run(
      `trigger on ${table}${fillable.length ? ` (may still fill: ${fillable.join(", ")})` : " (fully frozen)"}`,
      `CREATE TRIGGER ${trigger} BEFORE UPDATE OR DELETE ON "${table}" FOR EACH ROW EXECUTE FUNCTION refuse_mutation('${arg}')`,
    );
  }

  console.log(`\n2. Privilege revocation for a dedicated app role (${APP_ROLE})`);
  const roleExists = await prisma.$queryRawUnsafe<{ ok: boolean }[]>(
    `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS ok`,
    APP_ROLE,
  );
  if (!roleExists[0]?.ok) {
    console.log(`  skip  role "${APP_ROLE}" does not exist — nothing to revoke.`);
    console.log("        This is normal on Neon, where one role owns everything.");
  } else {
    for (const { table } of APPEND_ONLY) {
      await run(`revoke DELETE on ${table}`, `REVOKE DELETE ON "${table}" FROM "${APP_ROLE}"`, true);
    }
  }

  console.log("\n3. Proving the triggers behave, not just that they exist");
  let proven = 0;
  for (const { table, fillable, frozenColumn } of APPEND_ONLY) {
    const trigger = `${table.toLowerCase()}_immutable`;

    const installed = await prisma.$queryRawUnsafe<{ enabled: string }[]>(
      `SELECT tgenabled::text AS enabled FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       WHERE c.relname = $1 AND t.tgname = $2 AND NOT t.tgisinternal`,
      table,
      trigger,
    );
    if (installed.length === 0) {
      console.log(`  FAIL  ${table}: trigger not installed.`);
      continue;
    }
    if (installed[0].enabled === "D") {
      console.log(`  FAIL  ${table}: trigger installed but DISABLED.`);
      continue;
    }

    const [{ count }] = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::bigint AS count FROM "${table}"`,
    );
    if (count === 0n) {
      console.log(`  ok     ${table}: trigger present and enabled (no rows yet to probe against)`);
      proven++;
      continue;
    }

    // Every probe runs inside a transaction that is always rolled back, so
    // nothing here can alter real data even when a write is permitted.
    const probe = async (sql: string) =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(sql);
        throw new Error("ROLLBACK_PROBE");
      });

    const outcome = async (sql: string): Promise<"refused" | "allowed" | string> => {
      try {
        await probe(sql);
        return "allowed";
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (/ROLLBACK_PROBE/.test(msg)) return "allowed";
        if (/append-only/i.test(msg)) return "refused";
        const line = msg.split("\n").map((l) => l.trim()).filter(Boolean)[0] ?? msg;
        return `error: ${line.slice(0, 70)}`;
      }
    };

    const oneRow = `WHERE "id" = (SELECT "id" FROM "${table}" LIMIT 1)`;

    const frozen = await outcome(`UPDATE "${table}" SET "${frozenColumn}" = "${frozenColumn}" || '-tampered' ${oneRow}`);
    const deleted = await outcome(`DELETE FROM "${table}" ${oneRow}`);
    // A fillable column ending in "Id" is a foreign key, so the probe must use
    // a value that actually exists or the constraint fires before the trigger
    // does and the result says nothing about immutability.
    const fillValue = fillable.length
      ? fillable[0].endsWith("Id")
        ? `(SELECT "id" FROM "${table}" ORDER BY "id" DESC LIMIT 1)`
        : `'probe'`
      : null;

    const enrich = fillValue
      ? await outcome(
          `UPDATE "${table}" SET "${fillable[0]}" = ${fillValue} ${oneRow} AND "${fillable[0]}" IS NULL`,
        )
      : "n/a";

    const ok = frozen === "refused" && deleted === "refused" && (enrich === "allowed" || enrich === "n/a");
    if (ok) proven++;

    console.log(
      `  ${ok ? "proven" : "FAIL  "} ${table}: tamper=${frozen}, delete=${deleted}` +
        (enrich === "n/a" ? ", fully frozen" : `, permitted enrichment=${enrich}`),
    );
  }

  console.log("");
  if (proven === APPEND_ONLY.length) {
    console.log(`Hardening applied. ${proven} of ${APPEND_ONLY.length} audit tables are append-only and proven so.`);
  } else {
    console.log(`Applied, but only ${proven} of ${APPEND_ONLY.length} tables proved immutable. Investigate before relying on it.`);
    process.exitCode = 1;
  }

  if (ownsEverything) {
    console.log(
      "\nNote: this connection owns the tables, so privilege revocation cannot apply to it.\n" +
        "The triggers above are what enforce immutability. To add the privilege layer as well,\n" +
        "create a non-owner role, grant it CRUD, point DATABASE_URL at it, and re-run this script.",
    );
  }

  console.log(
    "\nRetention is a separate job and is deliberately NOT automated here: an append-only\n" +
      "table nobody prunes eventually fills the disk, which is its own outage. Run as owner:\n" +
      "  DELETE FROM \"SecurityEvent\"\n" +
      "  WHERE \"createdAt\" < now() - interval '180 days' AND severity IN ('LOW','MEDIUM');",
  );
}

main()
  .catch((error) => {
    console.error("\nHardening failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
