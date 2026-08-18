import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

/**
 * Reference data only.
 *
 * This seed creates the things that must EXIST before anyone can enter a real
 * transformer: staff accounts, KPLC stores, and the manufacturers KPLC buys
 * from. It creates no transformers, no events, no tests, no claims, no alerts.
 * Those are now entered by real people doing real work.
 *
 * Stores and manufacturers stay because they are not demo noise — they are
 * reference tables. Delete them and the "Receive a transformer" form has two
 * empty dropdowns and nobody can enter anything at all.
 *
 * Run with:  npm run db:seed
 */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Run `npx vercel env pull .env`.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/**
 * Empty every table, in one statement, without caring about order.
 *
 * The previous version was a hand-written list of eight `deleteMany()` calls
 * ordered children-before-parents. Two things were wrong with it.
 *
 * The immediate bug: it was incomplete and out of date. The schema has thirty
 * models and sixty foreign keys, only eleven of which cascade. TransactionRecord
 * references Transformer with Prisma's default RESTRICT and was never deleted,
 * so `prisma.transformer.deleteMany()` failed with
 *
 *   update or delete on table "Transformer" violates RESTRICT setting of
 *   foreign key constraint "TransactionRecord_transformerId_fkey"
 *
 * TransformerBatch, Allocation, ApprovalDocument, RepairRecord and several
 * others sit in exactly the same position and would have failed next, one at a
 * time, each looking like a fresh bug.
 *
 * The deeper problem: a hand-maintained delete order is a second copy of the
 * schema's dependency graph that nothing keeps in sync. It was already stale,
 * and adding TransactionRecord to the list would only have made it stale later
 * instead of now — the next model somebody adds breaks the seed again.
 *
 * TRUNCATE ... CASCADE has no order to get wrong. The table list is read from
 * the database's own catalog, so it cannot drift from the schema, and RESTART
 * IDENTITY resets the Int autoincrement on MeterReading and friends so a
 * re-seed starts from 1 rather than continuing to climb.
 *
 * Prisma's own bookkeeping table is excluded: wiping migration history would
 * make the next `prisma migrate` believe this database has never been migrated.
 */
async function clearEverything() {
  /**
   * The stop that should have been here from the first line of this function.
   *
   * clearEverything() enumerates every table in the public schema and TRUNCATEs
   * it with CASCADE. Run against production that is not a seed, it is the end of
   * the asset register — and it has already cost the fleet its geocoded
   * coordinates once. DATABASE_URL is one copied environment variable away from
   * pointing at Neon, so the guard cannot be "remember not to".
   */
  if (
    process.env.NODE_ENV === "production" ||
    process.env.ALLOW_DESTRUCTIVE_SEED !== "yes"
  ) {
    throw new Error(
      "Refusing to wipe the database.\n" +
        "clearEverything() TRUNCATEs every table. To run it deliberately on a\n" +
        "development database, set ALLOW_DESTRUCTIVE_SEED=yes for this one command.\n" +
        `NODE_ENV=${process.env.NODE_ENV ?? "undefined"}`,
    );
  }
  console.log("Clearing all data...");

  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '\\_prisma%'
  `;

  if (tables.length === 0) {
    console.log("  (no tables yet — run `prisma db push` first)");
    return;
  }

  // Quoted because Prisma's table names are PascalCase and Postgres folds
  // unquoted identifiers to lower case.
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);

  console.log(`  ${tables.length} tables emptied.`);
}

async function main() {
  await clearEverything();

  // --- Stores --------------------------------------------------------------
  console.log("Creating stores...");
  const ruaraka = await prisma.store.create({
    data: {
      name: "Ruaraka Central Store",
      code: "NRB-RRK",
      region: "Nairobi North",
      county: "Nairobi",
      lat: -1.2333,
      lng: 36.8667,
    },
  });
  await prisma.store.create({
    data: {
      name: "Kisumu Regional Store",
      code: "KSM-CTR",
      region: "Kisumu",
      county: "Kisumu",
      lat: -0.0917,
      lng: 34.768,
    },
  });
  await prisma.store.create({
    data: {
      name: "Nakuru Regional Store",
      code: "NKR-CTR",
      region: "Nakuru",
      county: "Nakuru",
      lat: -0.2833,
      lng: 36.0667,
    },
  });

  // A WORKSHOP, not a store. Four of the eleven movements — STORE_TO_WORKSHOP,
  // SITE_TO_WORKSHOP, WORKSHOP_TO_STORE, WORKSHOP_TO_SITE — have no valid
  // destination without one, so the entire repair loop is unreachable on a
  // fresh database. The transfer form said so honestly, which meant the first
  // thing anyone did on a clean install was go and create this by hand.
  const embakasiWorkshop = await prisma.store.create({
    data: {
      name: "Embakasi Repair Workshop",
      code: "NRB-EMB-WS",
      region: "Nairobi North",
      county: "Nairobi",
      kind: "WORKSHOP",
      lat: -1.3167,
      lng: 36.9,
    },
  });

  // --- Staff accounts ------------------------------------------------------
  // A distinct PIN per role. One shared demo PIN means a single shoulder-surf
  // at the conference hands someone the manager's account.
  console.log("Creating staff accounts...");
  const hash = (pin: string) => bcrypt.hash(pin, 12);

  await prisma.user.create({
    data: {
      name: "System Administrator",
      email: "admin@kplc.co.ke",
      staffNumber: "KP-ADM-001",
      pinHash: await hash("100100"),
      role: "ADMIN",
    },
  });
  await prisma.user.create({
    data: {
      name: "Grace Wanjiru",
      email: "manager@kplc.co.ke",
      staffNumber: "KP-MGR-114",
      phone: "0722114533",
      pinHash: await hash("200200"),
      role: "MANAGER",
      region: "Nairobi North",
    },
  });
  await prisma.user.create({
    data: {
      name: "Daniel Kimani",
      email: "store@kplc.co.ke",
      staffNumber: "KP-STR-227",
      phone: "0733227841",
      pinHash: await hash("300300"),
      role: "STORE_KEEPER",
      region: "Nairobi North",
      storeId: ruaraka.id,
    },
  });
  await prisma.user.create({
    data: {
      name: "Brian Ochieng",
      email: "field@kplc.co.ke",
      staffNumber: "KP-FLD-386",
      phone: "0710386294",
      pinHash: await hash("400400"),
      role: "FIELD_ENGINEER",
      region: "Nairobi North",
    },
  });
  // --- Workshop technicians ------------------------------------------------
  // A technician is a STORE_KEEPER whose store is a WORKSHOP. There is no
  // separate role: see lib/workshop.ts for why. Two of them, because the
  // one-job-at-a-time rule and the queue it creates are invisible with one.
  await prisma.user.create({
    data: {
      name: "Peter Mwangi",
      email: "tech1@kplc.co.ke",
      staffNumber: "KP-TCH-071",
      phone: "0726071445",
      pinHash: await hash("600600"),
      role: "STORE_KEEPER",
      region: "Nairobi North",
      storeId: embakasiWorkshop.id,
    },
  });
  await prisma.user.create({
    data: {
      name: "Susan Achieng",
      email: "tech2@kplc.co.ke",
      staffNumber: "KP-TCH-083",
      phone: "0737083220",
      pinHash: await hash("700700"),
      role: "STORE_KEEPER",
      region: "Nairobi North",
      storeId: embakasiWorkshop.id,
    },
  });

  // A STORE_MANAGER scoped to the Embakasi workshop. The role has its own
  // approval queue, its own bell and its own store-level scoping rule, and
  // without an account none of that can be seen — the scoping story is one of
  // the stronger things in this system and it was invisible on a clean install.
  //
  // Scoped by storeId, NOT by region: that foreign key is the whole point of
  // the role existing separately from MANAGER. A workshop is a Store with
  // kind: WORKSHOP, so it is a valid scope for this role exactly as a store is.
  //
  // Worth knowing when demonstrating: countPendingApprovals() scopes a store
  // manager with { currentStoreId: user.storeId }, so this account sees
  // approvals for units currently held AT THE WORKSHOP — the repair loop. It
  // will NOT see a consignment Daniel receives into Ruaraka. Point it at
  // `ruaraka.id` instead if the receive-then-approve flow is the one being
  // shown.
  await prisma.user.create({
    data: {
      name: "Alice Njeri",
      email: "storemanager@kplc.co.ke",
      staffNumber: "KP-SMG-052",
      phone: "0724052118",
      pinHash: await hash("500500"),
      role: "STORE_MANAGER",
      region: "Nairobi North",
      storeId: embakasiWorkshop.id,
    },
  });

  // --- Manufacturers -------------------------------------------------------
  // Warranty months differ per supplier on purpose — that is the contract, and
  // it is copied onto each transformer at registration.
  console.log("Creating manufacturers...");
  await prisma.manufacturer.createMany({
    data: [
      {
        name: "Hitachi Energy",
        country: "Sweden",
        contactName: "Regional Service Desk",
        contactEmail: "service.ke@hitachienergy.com",
        contactPhone: "+254 20 693 0000",
        warrantyMonths: 36,
      },
      {
        name: "Kirloskar Electric",
        country: "India",
        contactName: "Export Warranty Cell",
        contactEmail: "warranty@kirloskarelectric.com",
        contactPhone: "+91 80 2839 6000",
        warrantyMonths: 24,
      },
      {
        name: "Vijai Electricals",
        country: "India",
        contactName: "After Sales",
        contactEmail: "support@vijaielectricals.com",
        contactPhone: "+91 40 2354 1122",
        warrantyMonths: 24,
      },
      {
        name: "Transformers & Rectifiers India",
        country: "India",
        contactName: "Claims Department",
        contactEmail: "claims@transformerindia.com",
        contactPhone: "+91 79 2287 0622",
        warrantyMonths: 18,
      },
    ],
  });

  const [users, stores, workshops, technicians, manufacturers, transformers] = await Promise.all([
    prisma.user.count(),
    prisma.store.count({ where: { kind: "STORE" } }),
    prisma.store.count({ where: { kind: "WORKSHOP" } }),
    prisma.user.count({ where: { active: true, store: { kind: "WORKSHOP" }, role: "STORE_KEEPER" } }),
    prisma.manufacturer.count(),
    prisma.transformer.count(),
  ]);

  console.log(`
  Reference data ready.
    Staff accounts .. ${users}
    Stores .......... ${stores}
    Workshops ....... ${workshops}
    Technicians ..... ${technicians}
    Manufacturers ... ${manufacturers}
    Transformers .... ${transformers}   (empty — real data is entered by real users)

  Sign in with:
    admin@kplc.co.ke          PIN 100100   Administrator
    manager@kplc.co.ke        PIN 200200   Regional Manager (Nairobi North)
    storemanager@kplc.co.ke   PIN 500500   Store Manager (Embakasi Workshop — approvals)
    store@kplc.co.ke          PIN 300300   Store Keeper (Ruaraka)
    field@kplc.co.ke          PIN 400400   Field Engineer (Nairobi North)
    tech1@kplc.co.ke          PIN 600600   Workshop Technician (Embakasi)
    tech2@kplc.co.ke          PIN 700700   Workshop Technician (Embakasi)
  `);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
