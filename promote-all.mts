import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./src/generated/prisma/client";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const BASE = "http://localhost:3000";

const r0 = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "manager@kplc.co.ke", pin: "200200" }) });
const cookie = (r0.headers.get("set-cookie") ?? "").split(";")[0];

const staged = await fetch(`${BASE}/api/inspections/staged`, { headers: { cookie } }).then((r) => r.json());
const keys: string[] = staged.units.filter((u: { blockers: string[] }) => !u.blockers.length).map((u: { key: string }) => u.key);
console.log(`Promoting ${keys.length} of ${staged.totals.total} staged units (${staged.totals.blocked} blocked)\n`);

let promoted = 0, skipped = 0, failed = 0;
const reasons = new Map<string, number>();

for (let i = 0; i < keys.length; i += 25) {
  const slice = keys.slice(i, i + 25);
  // Batches of 50 against a remote database exceed undici's 30 s header
  // timeout. 25 at a time, with the timeout raised, keeps each request short
  // enough to answer and small enough to retry cheaply.
  let res: Response;
  try {
    res = await fetch(`${BASE}/api/inspections/promote`, {
      method: "POST", headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ keys: slice }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (e) {
    console.log(`
  batch at ${i} timed out, continuing: ${e instanceof Error ? e.message : e}`);
    failed += slice.length;
    continue;
  }
  const d = await res.json();
  if (!res.ok) { console.log(`  batch ${i} FAILED: ${JSON.stringify(d).slice(0, 200)}`); failed += slice.length; continue; }
  promoted += d.promoted; skipped += d.skipped; failed += d.failed;
  for (const det of d.details ?? []) {
    if (det.outcome !== "PROMOTED" && det.reason) {
      const k = det.reason.replace(/G-[\w-]+|\d{4,}/g, "…");
      reasons.set(k, (reasons.get(k) ?? 0) + 1);
    }
  }
  process.stdout.write(`\r  ${Math.min(i + 50, keys.length)} / ${keys.length}  ·  ${promoted} promoted, ${skipped} skipped, ${failed} failed   `);
}

console.log(`\n\nWHY UNITS WERE SKIPPED`);
for (const [r, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${r}`);

const total = await prisma.transformer.count();
const fromRegister = await prisma.transformer.count({ where: { dataSource: "INSPECTION_REGISTER" } });
const events = await prisma.lifecycleEvent.count();
const stillStaged = await prisma.substationInspection.count({ where: { transformerId: null } });

console.log(`\nREGISTER NOW`);
console.log(`  transformers total        ${total}`);
console.log(`  from inspection register  ${fromRegister}`);
console.log(`  chain events              ${events}`);
console.log(`  inspections still staged  ${stillStaged}`);

const target = await prisma.transformer.findFirst({
  where: { gNumber: "153457" },
  include: { manufacturer: true, inspections: true, events: true },
});
console.log(`\nTHE EMDIS TRANSFORMER`);
if (!target) console.log("  G-153457 NOT FOUND — Step 5 is still blocked");
else {
  console.log(`  ${target.gNumber} · ${target.manufacturer.name} · ${target.ratingKva} kVA · ${target.status}`);
  console.log(`  substation ${target.substationCode} — ${target.substationName}`);
  console.log(`  serial ${target.serialNumber}`);
  console.log(`  ${target.inspections.length} inspection(s), ${target.events.length} chain event(s)`);
  console.log(`  loadAction on file: ${target.inspections[0]?.loadAction}`);
  console.log(`  READY for EMDis load data.`);
}
await prisma.$disconnect();
