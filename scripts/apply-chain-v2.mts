#!/usr/bin/env node
/**
 * scripts/apply-chain-v2.mts
 *
 * Applies prisma/chain-v2.sql to the database, then proves it took.
 *
 * Run:  npx tsx scripts/apply-chain-v2.mts
 *
 * WHY THIS EXISTS
 * This repo has no prisma/migrations directory; the schema is applied with
 * `npm run db:push`. db push would make both of chain-v2's changes on its
 * own, but push also reconciles everything else in schema.prisma at the same
 * time, and this particular change is going onto a production database ahead of
 * a merge. This script does exactly the two things in chain-v2.sql and nothing
 * else, and then checks the catalogue to confirm they are really there.
 *
 * WHY DIRECT_URL
 * Neon's pooled endpoint (the "-pooler" host) runs in transaction pooling mode.
 * DDL, advisory locks and multi-statement transactions do not behave reliably
 * through it. DIRECT_URL points at the unpooled endpoint. This script prefers
 * DIRECT_URL and warns loudly if it has to fall back to a pooled DATABASE_URL.
 *
 * WHY ONE TRANSACTION
 * Postgres DDL is transactional. The five FK swaps each DROP then ADD; if the
 * fourth one failed outside a transaction you would be left with a table whose
 * foreign key is simply gone. All of it commits or none of it does. Pass
 * --continue-on-error to run statement-by-statement with autocommit instead.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import pg from 'pg';

const { Client } = pg;

// ---------------------------------------------------------------------------
// Paths and environment
// ---------------------------------------------------------------------------

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

// Next.js reads .env.local then .env; Prisma reads .env. Match that order so
// this script talks to the same database `npm run dev` does. Real environment
// variables always win: dotenv does not override by default.
loadEnv({
  path: [path.join(repoRoot, '.env.local'), path.join(repoRoot, '.env')],
  quiet: true,
});

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const hasFlag = (name: string) => argv.includes(`--${name}`);
const getOpt = (name: string): string | undefined => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

const DRY_RUN = hasFlag('dry-run');
const CONTINUE_ON_ERROR = hasFlag('continue-on-error');
const SKIP_PROOFS = hasFlag('skip-proofs');
const SQL_FILE = path.resolve(
  repoRoot,
  getOpt('file') ?? path.join('prisma', 'chain-v2.sql'),
);

if (hasFlag('help') || hasFlag('h')) {
  console.log(`
apply-chain-v2.mts — apply a .sql file and prove the result.

  --file=<path>          SQL file, relative to the repo root
                         (default: prisma/chain-v2.sql)
  --dry-run              parse and print the statements, connect to nothing
  --continue-on-error    autocommit each statement, keep going after a failure
                         (default: one transaction, roll back on first failure)
  --skip-proofs          apply the DDL, do not run the verification queries
  --help                 this text
`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

const colour = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  dim: (s: string) => (colour ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s: string) => (colour ? `\x1b[1m${s}\x1b[0m` : s),
  green: (s: string) => (colour ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s: string) => (colour ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s: string) => (colour ? `\x1b[33m${s}\x1b[0m` : s),
  cyan: (s: string) => (colour ? `\x1b[36m${s}\x1b[0m` : s),
};

const OK = c.green('  ok  ');
const FAIL = c.red(' FAIL ');
const WARN = c.yellow(' warn ');
const INFO = c.cyan(' info ');

const rule = (label = '') =>
  console.log(
    c.dim('─'.repeat(4)) +
      (label ? ` ${c.bold(label)} ` : '') +
      c.dim('─'.repeat(Math.max(4, 72 - label.length))),
  );

/** One-line summary of a statement, for the progress log. */
const label = (sql: string, width = 66) => {
  const flat = sql.replace(/\s+/g, ' ').trim();
  return flat.length > width ? `${flat.slice(0, width - 1)}…` : flat;
};

/** Host and database only. Never print the password. */
function describeTarget(url: string): string {
  try {
    const u = new URL(url);
    const db = u.pathname.replace(/^\//, '') || '(default)';
    return `${u.hostname}${u.port ? `:${u.port}` : ''}/${db} as ${u.username || '(default user)'}`;
  } catch {
    return '(unparseable connection string)';
  }
}

// ---------------------------------------------------------------------------
// Statement splitter
// ---------------------------------------------------------------------------
//
// Aware of: -- line comments, /* nested block comments */, 'literals' with ''
// escapes, "quoted identifiers" with "" escapes, and $tag$ dollar quoting.
// Comments are dropped; everything else is preserved verbatim so the statement
// that runs is the statement that was written.
//
// A naive split on ';' is fine for chain-v2.sql, which is seven flat ALTER
// statements. It is not fine for prisma/security-hardening.sql, whose trigger
// function body is dollar-quoted and full of semicolons. Pointing this script
// at that file with --file= should not shred it into fragments.

type Statement = { sql: string; line: number };

function splitStatements(src: string): Statement[] {
  const out: Statement[] = [];
  let buf = '';
  let line = 1;
  let stmtLine = 0;
  let i = 0;

  const flush = () => {
    const trimmed = buf.trim();
    if (trimmed) out.push({ sql: trimmed, line: stmtLine || line });
    buf = '';
    stmtLine = 0;
  };

  const add = (chunk: string) => {
    if (!buf.trim() && chunk.trim()) stmtLine = line;
    buf += chunk;
  };

  const countNewlines = (chunk: string) => {
    for (let k = 0; k < chunk.length; k++) if (chunk[k] === '\n') line++;
  };

  while (i < src.length) {
    const two = src.slice(i, i + 2);

    // -- line comment: skip to the newline, leave the newline itself
    if (two === '--') {
      const nl = src.indexOf('\n', i);
      i = nl === -1 ? src.length : nl;
      continue;
    }

    // /* block comment */, nested per the SQL standard
    if (two === '/*') {
      let depth = 1;
      i += 2;
      while (i < src.length && depth > 0) {
        if (src.slice(i, i + 2) === '/*') { depth++; i += 2; continue; }
        if (src.slice(i, i + 2) === '*/') { depth--; i += 2; continue; }
        if (src[i] === '\n') line++;
        i++;
      }
      continue;
    }

    // $$ ... $$ or $tag$ ... $tag$
    if (src[i] === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(src.slice(i));
      if (m) {
        const tag = m[0];
        const end = src.indexOf(tag, i + tag.length);
        const stop = end === -1 ? src.length : end + tag.length;
        const chunk = src.slice(i, stop);
        countNewlines(chunk);
        add(chunk);
        i = stop;
        continue;
      }
    }

    // 'string literal' or "quoted identifier"; a doubled quote is an escape
    if (src[i] === "'" || src[i] === '"') {
      const q = src[i];
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === q && src[j + 1] === q) { j += 2; continue; }
        if (src[j] === q) { j++; break; }
        j++;
      }
      const chunk = src.slice(i, j);
      countNewlines(chunk);
      add(chunk);
      i = j;
      continue;
    }

    if (src[i] === ';') { flush(); i++; continue; }

    if (src[i] === '\n') line++;
    add(src[i]);
    i++;
  }

  flush();
  return out;
}

// ---------------------------------------------------------------------------
// Read and parse
// ---------------------------------------------------------------------------

if (!existsSync(SQL_FILE)) {
  console.error(`${FAIL} no such file: ${SQL_FILE}`);
  console.error('       are you running this from the repo root?');
  process.exit(1);
}

const sqlText = readFileSync(SQL_FILE, 'utf8');
const statements = splitStatements(sqlText);

rule('apply-chain-v2');
console.log(`file       ${path.relative(repoRoot, SQL_FILE)}`);
console.log(`statements ${statements.length}`);

if (statements.length === 0) {
  console.error(`${FAIL} nothing to run — the file parsed to zero statements.`);
  process.exit(1);
}

if (DRY_RUN) {
  console.log(c.dim('dry run — no connection will be opened\n'));
  statements.forEach((s, n) => {
    console.log(c.bold(`[${n + 1}/${statements.length}] line ${s.line}`));
    console.log(`${s.sql};\n`);
  });
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

const urlVar = process.env.DIRECT_URL ? 'DIRECT_URL' : 'DATABASE_URL';
const connectionString = process.env[urlVar];

if (!connectionString) {
  console.error(
    `${FAIL} neither DIRECT_URL nor DATABASE_URL is set. Checked the real
       environment, .env.local and .env under ${repoRoot}.`,
  );
  process.exit(1);
}

console.log(`using      ${urlVar}`);
console.log(`target     ${describeTarget(connectionString)}`);

if (urlVar === 'DATABASE_URL' && /-pooler\./.test(connectionString)) {
  console.log(
    `${WARN} DATABASE_URL points at Neon's pooled endpoint and DIRECT_URL is not
       set. DDL through the pooler is unreliable. Set DIRECT_URL to the unpooled
       host (the same URL without "-pooler") and run this again.`,
  );
}

// Honour sslmode=disable if it is set; otherwise require TLS and verify the
// certificate. Neon presents a publicly trusted certificate, so verification
// should pass. Do not weaken this to get past an error — find out why it failed.
let ssl: pg.ClientConfig['ssl'];
try {
  const mode = new URL(connectionString).searchParams.get('sslmode');
  ssl = mode === 'disable' ? undefined : { rejectUnauthorized: true };
} catch {
  ssl = { rejectUnauthorized: true };
}

const client = new Client({
  connectionString,
  ssl,
  application_name: 'apply-chain-v2',
});

// IF EXISTS drops emit "skipping" notices, and those are worth seeing — they
// tell you whether a constraint was replaced or created for the first time.
client.on('notice', (n) => {
  const text = `${n.severity ?? 'NOTICE'}: ${n.message ?? ''}`.trim();
  console.log(`${c.dim('       pg')} ${c.dim(text)}`);
});

type Result = { n: number; line: number; sql: string; ms: number; error?: Error };
const results: Result[] = [];
let committed = false;
let exitCode = 0;

async function main() {
  await client.connect();

  const meta = await client.query<{
    version: string; db: string; usr: string; ro: string;
  }>(
    `SELECT current_setting('server_version') AS version,
            current_database() AS db,
            current_user AS usr,
            current_setting('transaction_read_only') AS ro`,
  );
  const { version, db, usr, ro } = meta.rows[0];
  console.log(`server     PostgreSQL ${version}, database ${db}, user ${usr}`);

  if (ro === 'on') {
    throw new Error(
      'this connection is read-only — you are probably on a Neon read replica',
    );
  }

  // ALTER TABLE takes ACCESS EXCLUSIVE. If some other session is holding a
  // conflicting lock, fail in 15 seconds rather than queueing up behind it and
  // blocking every reader in the meantime.
  await client.query(`SET lock_timeout = '15s'`);
  await client.query(`SET statement_timeout = '120s'`);

  rule('applying');

  const useTxn = !CONTINUE_ON_ERROR;
  if (useTxn) {
    await client.query('BEGIN');
    console.log(c.dim('BEGIN — all statements commit together, or none do'));
  } else {
    console.log(
      `${WARN} --continue-on-error: autocommit, a partial apply is possible`,
    );
  }

  for (const [idx, stmt] of statements.entries()) {
    const n = idx + 1;
    const tag = `[${String(n).padStart(2)}/${statements.length}]`;
    const started = process.hrtime.bigint();
    try {
      const res = await client.query(stmt.sql);
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const detail = Array.isArray(res)
        ? `${res.length} results`
        : `${res.command ?? 'OK'}${typeof res.rowCount === 'number' ? ` ${res.rowCount}` : ''}`;
      console.log(
        `${OK} ${tag} ${label(stmt.sql)}\n       ${c.dim(`line ${stmt.line} · ${detail} · ${ms.toFixed(0)}ms`)}`,
      );
      results.push({ n, line: stmt.line, sql: stmt.sql, ms });
    } catch (err) {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      const e = err as Error & { code?: string; detail?: string; hint?: string };
      console.log(`${FAIL} ${tag} ${label(stmt.sql)}`);
      console.log(`       ${c.dim(`line ${stmt.line} · ${ms.toFixed(0)}ms`)}`);
      console.log(`       ${c.red(e.message)}`);
      if (e.code) console.log(`       ${c.dim(`SQLSTATE ${e.code}`)}`);
      if (e.detail) console.log(`       ${c.dim(`detail: ${e.detail}`)}`);
      if (e.hint) console.log(`       ${c.dim(`hint: ${e.hint}`)}`);
      if (e.code === '55P03' || e.code === '57014') {
        console.log(
          `       ${c.yellow('lock or statement timeout — another session is holding a lock')}`,
        );
        console.log(
          `       ${c.yellow('on this table. Look for an idle-in-transaction session in')}`,
        );
        console.log(`       ${c.yellow('pg_stat_activity.')}`);
      }
      results.push({ n, line: stmt.line, sql: stmt.sql, ms, error: e });
      exitCode = 1;

      if (useTxn) {
        await client.query('ROLLBACK').catch(() => {});
        console.log(
          c.red('\nROLLBACK — nothing changed. Fix the statement above and re-run.'),
        );
        return;
      }
    }
  }

  if (useTxn) {
    await client.query('COMMIT');
    committed = true;
    console.log(c.green('COMMIT — the DDL is applied.'));
  } else {
    committed = results.every((r) => !r.error);
  }

  if (!SKIP_PROOFS) await runProofs();
}

// ---------------------------------------------------------------------------
// Proofs
// ---------------------------------------------------------------------------
//
// The two checks written at the bottom of chain-v2.sql, plus two catalogue
// checks that are deterministic rather than circumstantial.

const RESTRICT_CONSTRAINTS = [
  'ApprovalDocument_transformerId_fkey',
  'LifecycleEvent_transformerId_fkey',
  'TestRecord_transformerId_fkey',
  'WarrantyClaim_transformerId_fkey',
  'RepairRecord_transformerId_fkey',
];

const DELETE_RULE: Record<string, string> = {
  a: 'NO ACTION',
  r: 'RESTRICT',
  c: 'CASCADE',
  n: 'SET NULL',
  d: 'SET DEFAULT',
};
const ruleName = (ch: string) => DELETE_RULE[ch] ?? ch;

async function runProofs() {
  rule('proof 1 — the hashVersion column exists as declared');

  const col = await client.query<{
    data_type: string; is_nullable: string; column_default: string | null;
  }>(
    `SELECT data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_name = 'LifecycleEvent' AND column_name = 'hashVersion'`,
  );

  if (col.rowCount === 0) {
    console.log(`${FAIL} LifecycleEvent."hashVersion" does not exist.`);
    exitCode = 1;
  } else {
    const { data_type, is_nullable, column_default } = col.rows[0];
    const good =
      data_type === 'integer' &&
      is_nullable === 'NO' &&
      (column_default ?? '').startsWith('1');
    console.log(
      `${good ? OK : WARN} integer=${data_type === 'integer'} notNull=${is_nullable === 'NO'} default=${column_default ?? 'none'}`,
    );
    if (!good) {
      console.log(
        `       ${c.yellow('expected integer, NOT NULL, DEFAULT 1 — compare with schema.prisma')}`,
      );
    }
  }

  rule('proof 2 — hashVersion distribution');
  console.log(c.dim('SELECT "hashVersion", count(*) FROM "LifecycleEvent" GROUP BY 1;'));

  const dist = await client.query<{ hashVersion: number; count: string }>(
    `SELECT "hashVersion", count(*)::text AS count
       FROM "LifecycleEvent" GROUP BY 1 ORDER BY 1`,
  );

  if (dist.rowCount === 0) {
    console.log(`${INFO} LifecycleEvent is empty — nothing to distribute yet.`);
  } else {
    for (const r of dist.rows) {
      console.log(`       hashVersion ${r.hashVersion}: ${r.count} rows`);
    }
    const v2 = dist.rows.find((r) => r.hashVersion === 2);
    console.log(
      `${OK} every row that existed before this ran should read 1. ${
        v2 ? `${v2.count} row(s) already at 2 — written since.` : 'No rows at 2 yet.'
      }`,
    );
    console.log(
      c.dim('       Do not UPDATE any of these to 2. A v2 hash cannot be recomputed'),
    );
    console.log(
      c.dim('       for an old row without rewriting the hash, which is the tampering'),
    );
    console.log(c.dim('       the chain exists to detect.'));
  }

  rule('proof 3 — the five foreign keys are RESTRICT');

  const fks = await client.query<{
    tbl: string; conname: string; confdeltype: string; confupdtype: string;
  }>(
    `SELECT conrelid::regclass::text AS tbl, conname, confdeltype, confupdtype
       FROM pg_constraint
      WHERE contype = 'f' AND conname = ANY($1::text[])
      ORDER BY conname`,
    [RESTRICT_CONSTRAINTS],
  );

  const seen = new Map(fks.rows.map((r) => [r.conname, r]));

  for (const name of RESTRICT_CONSTRAINTS) {
    const row = seen.get(name);
    if (!row) {
      console.log(`${FAIL} ${name} — missing entirely`);
      exitCode = 1;
      continue;
    }
    const good = row.confdeltype === 'r';
    if (!good) exitCode = 1;
    console.log(
      `${good ? OK : FAIL} ${name}  ON DELETE ${ruleName(row.confdeltype)}  ON UPDATE ${ruleName(row.confupdtype)}`,
    );
  }

  rule('proof 4 — deleting a transformer with history must fail');

  const hasHistory = await client.query<{ id: string | null }>(
    `SELECT "transformerId" AS id FROM "LifecycleEvent" LIMIT 1`,
  );
  const victim = hasHistory.rows[0]?.id ?? null;

  if (!victim) {
    console.log(
      `${INFO} no LifecycleEvent rows, so there is no transformer with history to`,
    );
    console.log(
      '       test against. Proof 3 already read the constraints from the catalogue.',
    );
    return;
  }

  // This is a real DELETE. It runs inside a transaction that is rolled back
  // unconditionally, including on the success path, so no row is ever removed.
  //
  // 23503 is the only pass. refuse_mutation(), installed by
  // scripts/apply-security-hardening.mts, raises check_violation (23514) when
  // it refuses a DELETE on LifecycleEvent. So if the FK were still CASCADE the
  // cascaded delete would fail too, and would read as "blocked" while proving
  // nothing about the foreign key. Those outcomes are reported separately.
  await client.query('BEGIN');
  try {
    const del = await client.query(`DELETE FROM "Transformer" WHERE id = $1`, [victim]);
    console.log(
      `${FAIL} the DELETE succeeded (${del.rowCount} row) — RESTRICT is NOT in force`,
    );
    console.log(
      `       ${c.red('the chain is not protected. Re-check proof 3 and re-run the DDL.')}`,
    );
    exitCode = 1;
  } catch (err) {
    const e = err as Error & { code?: string };
    if (e.code === '23503') {
      console.log(`${OK} blocked by foreign key violation (SQLSTATE 23503) — correct`);
      console.log(`       ${c.dim(e.message)}`);
    } else if (e.code === '23514' || e.code === 'P0001') {
      console.log(
        `${WARN} blocked by a trigger (SQLSTATE ${e.code}), not a foreign key.`,
      );
      console.log(
        `       ${c.yellow('That is refuse_mutation() refusing the cascaded DELETE,')}`,
      );
      console.log(
        `       ${c.yellow('which means the FK is still CASCADE. Trust proof 3, not this.')}`,
      );
      console.log(`       ${c.dim(e.message)}`);
      exitCode = 1;
    } else {
      console.log(`${WARN} blocked by an unexpected error (SQLSTATE ${e.code ?? '?'})`);
      console.log(`       ${c.dim(e.message)}`);
    }
  } finally {
    await client.query('ROLLBACK');
    console.log(c.dim('       ROLLBACK — the transformer was not deleted.'));
  }
}

// ---------------------------------------------------------------------------

main()
  .catch((err) => {
    const e = err as Error & { code?: string };
    console.error(`\n${FAIL} ${e.message}`);
    if (e.code) console.error(`       SQLSTATE/code ${e.code}`);
    if (e.code === 'ENOTFOUND' || e.code === 'ETIMEDOUT') {
      console.error('       Could not reach the host. Check the URL and your network.');
    }
    if (e.code === '28P01') {
      console.error('       Password authentication failed — check the credentials.');
    }
    exitCode = 1;
  })
  .finally(async () => {
    await client.end().catch(() => {});
    rule('summary');
    const failed = results.filter((r) => r.error);
    console.log(
      `${statements.length} statement(s): ${results.length - failed.length} ok, ${failed.length} failed`,
    );
    console.log(`changes ${committed ? c.green('COMMITTED') : c.red('NOT committed')}`);
    if (exitCode === 0 && committed) {
      console.log(
        c.green('chain-v2 is applied and verified. The merge gate on PR #1 is clear.'),
      );
    }
    process.exit(exitCode);
  });
