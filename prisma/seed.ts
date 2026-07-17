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

async function main() {
  console.log("Clearing all data...");
  // Children before parents — foreign keys will not forgive the wrong order.
  await prisma.alert.deleteMany();
  await prisma.warrantyClaim.deleteMany();
  await prisma.testRecord.deleteMany();
  await prisma.lifecycleEvent.deleteMany();
  await prisma.transformer.deleteMany();
  await prisma.manufacturer.deleteMany();
  await prisma.user.deleteMany();
  await prisma.store.deleteMany();

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

  const [users, stores, manufacturers, transformers] = await Promise.all([
    prisma.user.count(),
    prisma.store.count(),
    prisma.manufacturer.count(),
    prisma.transformer.count(),
  ]);

  console.log(`
  Reference data ready.
    Staff accounts .. ${users}
    Stores .......... ${stores}
    Manufacturers ... ${manufacturers}
    Transformers .... ${transformers}   (empty — real data is entered by real users)

  Sign in with:
    admin@kplc.co.ke    PIN 100100   Administrator
    manager@kplc.co.ke  PIN 200200   Regional Manager (Nairobi North)
    store@kplc.co.ke    PIN 300300   Store Keeper (Ruaraka)
    field@kplc.co.ke    PIN 400400   Field Engineer (Nairobi North)
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
