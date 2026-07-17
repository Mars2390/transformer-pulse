import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  PrismaClient,
  type EventType,
  type TransformerStatus,
  type TestStage,
} from "../src/generated/prisma/client";
import { computeEventHash } from "../src/lib/chain";

/**
 * Seed data.
 *
 * Real Kenyan places, real coordinates, real transformer ratings, real test
 * values. Demo data that looks like demo data undermines the demo — an engineer
 * in the room will spot a 999 kVA transformer at "Site A" in one second, and
 * from then on nothing else you say is trusted.
 *
 * Run with:  npx prisma db seed
 */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Run `vercel env pull .env` after adding Neon to your Vercel project.",
  );
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

// --- Deterministic randomness ----------------------------------------------
// A fixed seed means every run produces the same database. When you rehearse
// the demo on Tuesday and present on Thursday, the numbers on your slides
// still match the screen.
function mulberry32(seed: number) {
  return function random() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260716);

const pick = <T>(items: readonly T[]): T =>
  items[Math.floor(rand() * items.length)];

const between = (min: number, max: number, dp = 2): number =>
  Number((min + rand() * (max - min)).toFixed(dp));

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number): Date => new Date(Date.now() - n * DAY);

// --- Reference data ---------------------------------------------------------

const SITES = [
  // Nairobi North — the manager's region, so it gets the most units.
  { name: "Kabete Primary School", lat: -1.2611, lng: 36.7108, region: "Nairobi North", county: "Nairobi", feeder: "KBT-11kV-04" },
  { name: "Kangemi Market", lat: -1.2667, lng: 36.7439, region: "Nairobi North", county: "Nairobi", feeder: "KBT-11kV-07" },
  { name: "Uthiru Shopping Centre", lat: -1.2733, lng: 36.7175, region: "Nairobi North", county: "Nairobi", feeder: "KBT-11kV-04" },
  { name: "Ruaraka Industrial Area", lat: -1.2333, lng: 36.8667, region: "Nairobi North", county: "Nairobi", feeder: "RRK-11kV-02" },
  { name: "Kasarani Stadium", lat: -1.2205, lng: 36.8969, region: "Nairobi North", county: "Nairobi", feeder: "KSR-11kV-01" },
  { name: "Githurai 44", lat: -1.1833, lng: 36.9167, region: "Nairobi North", county: "Nairobi", feeder: "KSR-11kV-05" },
  { name: "Zimmerman Estate", lat: -1.2103, lng: 36.8886, region: "Nairobi North", county: "Nairobi", feeder: "KSR-11kV-03" },
  { name: "Roysambu Roundabout", lat: -1.2186, lng: 36.8869, region: "Nairobi North", county: "Nairobi", feeder: "KSR-11kV-03" },
  { name: "Kahawa West", lat: -1.1889, lng: 36.9139, region: "Nairobi North", county: "Nairobi", feeder: "KHW-11kV-02" },
  { name: "Kahawa Sukari", lat: -1.1794, lng: 36.9308, region: "Nairobi North", county: "Nairobi", feeder: "KHW-11kV-04" },
  { name: "Ruiru Town", lat: -1.1453, lng: 36.9581, region: "Nairobi North", county: "Kiambu", feeder: "RRU-11kV-01" },
  { name: "Juja Farm", lat: -1.1036, lng: 37.0144, region: "Nairobi North", county: "Kiambu", feeder: "JJA-11kV-03" },
  { name: "Thika Makongeni", lat: -1.0388, lng: 37.0834, region: "Nairobi North", county: "Kiambu", feeder: "THK-11kV-06" },
  { name: "Mwiki Estate", lat: -1.2167, lng: 36.9333, region: "Nairobi North", county: "Nairobi", feeder: "KSR-11kV-05" },
  // Kisumu
  { name: "Kondele Market", lat: -0.0833, lng: 34.7667, region: "Kisumu", county: "Kisumu", feeder: "KSU-11kV-02" },
  { name: "Nyalenda Estate", lat: -0.1167, lng: 34.7667, region: "Kisumu", county: "Kisumu", feeder: "KSU-11kV-04" },
  { name: "Mamboleo Junction", lat: -0.05, lng: 34.7833, region: "Kisumu", county: "Kisumu", feeder: "KSU-11kV-01" },
  { name: "Ahero Trading Centre", lat: -0.1667, lng: 34.9167, region: "Kisumu", county: "Kisumu", feeder: "AHR-11kV-01" },
  // Nakuru
  { name: "Lanet Barracks", lat: -0.3333, lng: 36.1333, region: "Nakuru", county: "Nakuru", feeder: "LNT-11kV-02" },
  { name: "Bahati Centre", lat: -0.1833, lng: 36.15, region: "Nakuru", county: "Nakuru", feeder: "BHT-11kV-01" },
  { name: "Njoro Town", lat: -0.3333, lng: 35.9333, region: "Nakuru", county: "Nakuru", feeder: "NJR-11kV-03" },
] as const;

const RATINGS = [50, 100, 200, 315, 500] as const;
const PLATES = ["KDG456T", "KCP382K", "KBQ119X", "KDA774M", "KCF205J"] as const;
const DRIVERS = [
  { name: "Peter Mwangi", phone: "0722841503" },
  { name: "Joseph Otieno", phone: "0733920117" },
  { name: "Samuel Kiplagat", phone: "0710448265" },
  { name: "David Wanjala", phone: "0724330981" },
] as const;

const FAULTS = [
  "LV bushing flashover after lightning storm. Oil leak observed at the tank base.",
  "Persistent overheating; oil temperature above 95 °C under normal load.",
  "HV winding open circuit on the R phase. No output on the LV side.",
  "Tank rupture and oil loss following suspected vandalism of the earth strap.",
] as const;

async function main() {
  console.log("Clearing existing data...");
  // Order matters: children before parents.
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
    data: { name: "Ruaraka Central Store", code: "NRB-RRK", region: "Nairobi North", county: "Nairobi", lat: -1.2333, lng: 36.8667 },
  });
  const kisumu = await prisma.store.create({
    data: { name: "Kisumu Regional Store", code: "KSM-CTR", region: "Kisumu", county: "Kisumu", lat: -0.0917, lng: 34.768 },
  });
  const nakuru = await prisma.store.create({
    data: { name: "Nakuru Regional Store", code: "NKR-CTR", region: "Nakuru", county: "Nakuru", lat: -0.2833, lng: 36.0667 },
  });
  const storeFor: Record<string, string> = {
    "Nairobi North": ruaraka.id,
    Kisumu: kisumu.id,
    Nakuru: nakuru.id,
  };

  // --- Users ---------------------------------------------------------------
  // Distinct PIN per role. A single shared demo PIN means one shoulder-surf at
  // the conference gives someone the manager's account.
  console.log("Creating users...");
  const hash = (pin: string) => bcrypt.hash(pin, 12);

  const admin = await prisma.user.create({
    data: { name: "System Administrator", email: "admin@kplc.co.ke", staffNumber: "KP-ADM-001", pinHash: await hash("100100"), role: "ADMIN" },
  });
  const manager = await prisma.user.create({
    data: { name: "Grace Wanjiru", email: "manager@kplc.co.ke", staffNumber: "KP-MGR-114", phone: "0722114533", pinHash: await hash("200200"), role: "MANAGER", region: "Nairobi North" },
  });
  const keeper = await prisma.user.create({
    data: { name: "Daniel Kimani", email: "store@kplc.co.ke", staffNumber: "KP-STR-227", phone: "0733227841", pinHash: await hash("300300"), role: "STORE_KEEPER", region: "Nairobi North", storeId: ruaraka.id },
  });
  const engineer = await prisma.user.create({
    data: { name: "Brian Ochieng", email: "field@kplc.co.ke", staffNumber: "KP-FLD-386", phone: "0710386294", pinHash: await hash("400400"), role: "FIELD_ENGINEER", region: "Nairobi North" },
  });
  const engineer2 = await prisma.user.create({
    data: { name: "Mercy Chebet", email: "field2@kplc.co.ke", staffNumber: "KP-FLD-402", phone: "0724402118", pinHash: await hash("400400"), role: "FIELD_ENGINEER", region: "Kisumu" },
  });

  // --- Manufacturers -------------------------------------------------------
  console.log("Creating manufacturers...");
  const hitachi = await prisma.manufacturer.create({
    data: { name: "Hitachi Energy", country: "Sweden", contactName: "Regional Service Desk", contactEmail: "service.ke@hitachienergy.com", contactPhone: "+254 20 693 0000", warrantyMonths: 36 },
  });
  const kirloskar = await prisma.manufacturer.create({
    data: { name: "Kirloskar Electric", country: "India", contactName: "Export Warranty Cell", contactEmail: "warranty@kirloskarelectric.com", contactPhone: "+91 80 2839 6000", warrantyMonths: 24 },
  });
  const vijai = await prisma.manufacturer.create({
    data: { name: "Vijai Electricals", country: "India", contactName: "After Sales", contactEmail: "support@vijaielectricals.com", contactPhone: "+91 40 2354 1122", warrantyMonths: 24 },
  });
  const tril = await prisma.manufacturer.create({
    data: { name: "Transformers & Rectifiers India", country: "India", contactName: "Claims Department", contactEmail: "claims@transformerindia.com", contactPhone: "+91 79 2287 0622", warrantyMonths: 18 },
  });
  const makers = [
    { m: hitachi, prefix: "HE" },
    { m: kirloskar, prefix: "KE" },
    { m: vijai, prefix: "VE" },
    { m: tril, prefix: "TRIL" },
  ];

  // --- Transformers --------------------------------------------------------
  console.log("Creating transformers and their event chains...");

  let gCounter = 1040;
  let serialCounter = 4400;

  /** How many units land in each state. */
  const PLAN: { status: TransformerStatus; count: number }[] = [
    { status: "IN_STORE", count: 11 },
    { status: "IN_TRANSIT", count: 3 },
    { status: "IN_FIELD", count: 19 },
    { status: "FAULTY", count: 4 },
    { status: "RETURNED", count: 2 },
    { status: "SCRAPPED", count: 1 },
  ];

  for (const { status, count } of PLAN) {
    for (let i = 0; i < count; i++) {
      const maker = pick(makers);
      const site = pick(SITES);
      const rating = pick(RATINGS);
      const year = 2021 + Math.floor(rand() * 5);
      const goesToField = status !== "IN_STORE" && status !== "IN_TRANSIT";
      const region = status === "IN_STORE" ? pick(["Nairobi North", "Kisumu", "Nakuru"]) : site.region;
      const fieldUser = region === "Kisumu" ? engineer2 : engineer;

      // The clock starts at store intake, never at manufacture.
      const intakeAt = daysAgo(Math.floor(between(180, 900, 0)));

      const tx = await prisma.transformer.create({
        data: {
          serialNumber: `${maker.prefix}-${year}-${serialCounter++}`,
          gNumber: `G-2024-0${gCounter++}`,
          manufacturerId: maker.m.id,
          ratingKva: rating,
          primaryKv: 11,
          secondaryKv: 0.415,
          phases: 3,
          coolingType: "ONAN",
          impedancePct: between(3.8, 5.2, 1),
          vectorGroup: "Dyn11",
          oilVolumeLitres: Math.round(rating * between(0.55, 0.75)),
          yearOfManufacture: year,
          warrantyMonths: maker.m.warrantyMonths,
          warrantyStart: intakeAt,
          status,
          currentStoreId: goesToField ? null : storeFor[region],
          region,
        },
      });

      // --- Build the event chain --------------------------------------------
      let prevHash: string | null = null;
      let currentStatus: TransformerStatus | null = null;

      const addEvent = async (
        type: EventType,
        toStatus: TransformerStatus,
        occurredAt: Date,
        userId: string,
        extra: {
          lat?: number;
          lng?: number;
          locationName?: string;
          vehiclePlate?: string;
          driverName?: string;
          driverPhone?: string;
          destination?: string;
          notes?: string;
          photoUrls?: string[];
        } = {},
      ) => {
        const hash = computeEventHash(prevHash, {
          transformerId: tx.id,
          type,
          toStatus,
          userId,
          occurredAt,
          lat: extra.lat ?? null,
          lng: extra.lng ?? null,
          vehiclePlate: extra.vehiclePlate ?? null,
          driverName: extra.driverName ?? null,
          notes: extra.notes ?? null,
        });

        const event = await prisma.lifecycleEvent.create({
          data: {
            transformerId: tx.id,
            type,
            fromStatus: currentStatus,
            toStatus,
            userId,
            occurredAt,
            lat: extra.lat,
            lng: extra.lng,
            accuracyM: extra.lat ? between(3, 12, 1) : undefined,
            locationName: extra.locationName,
            vehiclePlate: extra.vehiclePlate,
            driverName: extra.driverName,
            driverPhone: extra.driverPhone,
            destination: extra.destination,
            notes: extra.notes,
            photoUrls: extra.photoUrls ?? [],
            prevHash,
            hash,
          },
        });

        prevHash = hash;
        currentStatus = toStatus;
        return event;
      };

      const addTest = async (
        stage: TestStage,
        eventId: string | null,
        testedById: string,
        testedAt: Date,
        passed: boolean,
      ) => {
        await prisma.testRecord.create({
          data: {
            transformerId: tx.id,
            eventId,
            stage,
            testedById,
            testedAt,
            // Real-world ranges. A passing unit sits comfortably inside the
            // IEC limits; a failing one breaches exactly one of them, which is
            // what a genuine failure usually looks like.
            insulationResistanceHvMohm: passed ? between(420, 1900, 0) : between(18, 74, 0),
            insulationResistanceLvMohm: passed ? between(260, 900, 0) : between(12, 48, 0),
            turnsRatio: between(26.4, 26.6, 3),
            turnsRatioDeviationPct: passed ? between(-0.28, 0.28) : between(0.7, 1.9),
            windingResistanceHvOhm: between(2.1, 4.8, 3),
            windingResistanceLvOhm: between(0.004, 0.012, 4),
            oilBdvKv: passed ? between(42, 68, 1) : between(14, 27, 1),
            oilTempC: between(24, 38, 1),
            ambientTempC: between(19, 31, 1),
            polarityOk: true,
            passed,
            remarks: passed
              ? "All values within IEC 60076 limits. Cleared for service."
              : "Values outside acceptable limits. Unit withdrawn from service.",
          },
        });
      };

      // 1. Arrival at the store — the genesis link of every chain.
      const receiveEvent = await addEvent("RECEIVED_AT_STORE", "IN_STORE", intakeAt, keeper.id, {
        lat: -1.2333,
        lng: 36.8667,
        locationName: `${maker.m.name} delivery to Ruaraka Central Store`,
        vehiclePlate: pick(PLATES),
        driverName: pick(DRIVERS).name,
        notes: `Received against delivery note. G-Number assigned. Warranty runs ${maker.m.warrantyMonths} months from today.`,
      });

      // 2. Intake testing.
      const intakeTestAt = new Date(intakeAt.getTime() + DAY);
      const testEvent = await addEvent("TESTED", "IN_STORE", intakeTestAt, keeper.id, {
        notes: "Store intake tests completed.",
      });
      await addTest("STORE_INTAKE", testEvent.id, keeper.id, intakeTestAt, true);

      if (status !== "IN_STORE") {
        const driver = pick(DRIVERS);
        const plate = pick(PLATES);
        const dispatchAt = new Date(intakeAt.getTime() + between(20, 90, 0) * DAY);

        // 3. Dispatch.
        await addEvent("DISPATCHED", "IN_TRANSIT", dispatchAt, keeper.id, {
          lat: -1.2333,
          lng: 36.8667,
          locationName: "Ruaraka Central Store",
          vehiclePlate: plate,
          driverName: driver.name,
          driverPhone: driver.phone,
          destination: site.name,
          notes: `Loaded for ${site.name}. Escort assigned.`,
        });

        if (goesToField) {
          // 4. Field confirms receipt.
          const arriveAt = new Date(dispatchAt.getTime() + 0.3 * DAY);
          await addEvent("RECEIVED_BY_FIELD", "IN_TRANSIT", arriveAt, fieldUser.id, {
            lat: site.lat,
            lng: site.lng,
            locationName: site.name,
            vehiclePlate: plate,
            driverName: driver.name,
            notes: "Received on site. Physical condition checked against dispatch note.",
          });

          // 5. Installation — where the GPS pin is born.
          const installAt = new Date(arriveAt.getTime() + 0.5 * DAY);
          const installEvent = await addEvent("INSTALLED", "IN_FIELD", installAt, fieldUser.id, {
            lat: site.lat,
            lng: site.lng,
            locationName: site.name,
            notes: `Mounted and energised on feeder ${site.feeder}.`,
          });
          await addTest("SITE_COMMISSIONING", installEvent.id, fieldUser.id, installAt, true);

          await prisma.transformer.update({
            where: { id: tx.id },
            data: {
              currentLat: site.lat,
              currentLng: site.lng,
              currentSiteName: site.name,
              feeder: site.feeder,
              county: site.county,
              region: site.region,
              sdb: `SDB-${site.feeder.split("-")[0]}-${Math.floor(between(1, 40, 0))}`,
              commissionDate: installAt,
            },
          });

          // 6. A routine inspection or two.
          const inspections = Math.floor(between(0, 3, 0));
          let lastAt = installAt;
          for (let k = 0; k < inspections; k++) {
            lastAt = new Date(lastAt.getTime() + between(60, 150, 0) * DAY);
            if (lastAt.getTime() > Date.now()) break;
            const inspectEvent = await addEvent("INSPECTED", "IN_FIELD", lastAt, fieldUser.id, {
              lat: site.lat,
              lng: site.lng,
              locationName: site.name,
              notes: pick([
                "Routine inspection. Bushings clean, no oil seepage, silica gel blue.",
                "Routine inspection. Minor rust on tank lid, scheduled for repainting.",
                "Routine inspection. Load readings normal, no abnormal noise.",
              ]),
            });
            await addTest("ROUTINE", inspectEvent.id, fieldUser.id, lastAt, true);
          }

          // 7. Failure paths.
          if (status === "FAULTY" || status === "RETURNED" || status === "SCRAPPED") {
            const faultAt = new Date(lastAt.getTime() + between(30, 120, 0) * DAY);
            const faultDate = faultAt.getTime() > Date.now() ? daysAgo(between(2, 25, 0)) : faultAt;
            const reason = pick(FAULTS);

            const faultEvent = await addEvent("FAULT_REPORTED", "FAULTY", faultDate, fieldUser.id, {
              lat: site.lat,
              lng: site.lng,
              locationName: site.name,
              notes: reason,
            });
            await addTest("POST_FAULT", faultEvent.id, fieldUser.id, faultDate, false);

            // Is it still under warranty on the day it failed?
            const expiry = new Date(intakeAt);
            expiry.setMonth(expiry.getMonth() + maker.m.warrantyMonths);
            const underWarranty = faultDate < expiry;

            await prisma.alert.create({
              data: {
                transformerId: tx.id,
                type: "FAULT_REPORTED",
                severity: "CRITICAL",
                region: site.region,
                message: `${rating} kVA at ${site.name} failed${underWarranty ? " while under warranty" : ""}. ${reason.split(".")[0]}.`,
                createdAt: faultDate,
              },
            });

            if (underWarranty) {
              // Indicative replacement values, in KES, by rating. These are
              // planning estimates for the recoverable-value figure — swap in
              // procurement's contract prices before negotiating with anyone.
              const VALUES: Record<number, number> = {
                50: 610_000, 100: 920_000, 200: 1_450_000, 315: 2_050_000, 500: 2_850_000,
              };
              await prisma.warrantyClaim.create({
                data: {
                  transformerId: tx.id,
                  manufacturerId: maker.m.id,
                  raisedById: manager.id,
                  status: status === "RETURNED" ? "SUBMITTED" : "OPEN",
                  faultReason: reason,
                  claimValueKes: VALUES[rating],
                  referenceNo: status === "RETURNED" ? `RMA-${maker.prefix}-${Math.floor(between(1000, 9999, 0))}` : null,
                  submittedAt: status === "RETURNED" ? new Date(faultDate.getTime() + 5 * DAY) : null,
                  createdAt: faultDate,
                },
              });
            }

            if (status === "RETURNED" || status === "SCRAPPED") {
              const driver2 = pick(DRIVERS);
              const recoverAt = new Date(faultDate.getTime() + 3 * DAY);
              await addEvent("RECOVERED", "IN_TRANSIT", recoverAt, fieldUser.id, {
                lat: site.lat,
                lng: site.lng,
                locationName: site.name,
                vehiclePlate: pick(PLATES),
                driverName: driver2.name,
                driverPhone: driver2.phone,
                destination: "Ruaraka Central Store",
                notes: "Removed from pole and loaded for return.",
              });

              const finalAt = new Date(recoverAt.getTime() + 6 * DAY);
              if (status === "RETURNED") {
                await addEvent("RETURNED_TO_MANUFACTURER", "RETURNED", finalAt, manager.id, {
                  vehiclePlate: pick(PLATES),
                  driverName: pick(DRIVERS).name,
                  destination: maker.m.name,
                  notes: `Shipped to ${maker.m.name} under warranty claim.`,
                });
              } else {
                await addEvent("SCRAPPED", "SCRAPPED", finalAt, manager.id, {
                  notes: "Tank breached beyond economical repair. Written off.",
                });
              }

              // It has left site — the map pin would now be a lie.
              await prisma.transformer.update({
                where: { id: tx.id },
                data: { currentLat: null, currentLng: null, currentSiteName: null },
              });
            }
          }
        }
      }

      await prisma.transformer.update({
        where: { id: tx.id },
        data: { lastEventHash: prevHash },
      });
    }
  }

  // --- Warranty expiry alerts ----------------------------------------------
  console.log("Raising warranty alerts...");
  const inField = await prisma.transformer.findMany({
    where: { status: "IN_FIELD" },
    include: { manufacturer: true },
  });

  for (const tx of inField) {
    if (!tx.warrantyStart) continue;
    const expiry = new Date(tx.warrantyStart);
    expiry.setMonth(expiry.getMonth() + tx.warrantyMonths);
    const daysLeft = Math.ceil((expiry.getTime() - Date.now()) / DAY);

    if (daysLeft > 0 && daysLeft <= 90) {
      await prisma.alert.create({
        data: {
          transformerId: tx.id,
          type: "WARRANTY_EXPIRING",
          severity: daysLeft <= 30 ? "CRITICAL" : "WARNING",
          region: tx.region,
          message: `Warranty on ${tx.gNumber} (${tx.ratingKva} kVA, ${tx.manufacturer.name}) at ${tx.currentSiteName} expires in ${daysLeft} days.`,
        },
      });
    }
  }

  // --- Summary --------------------------------------------------------------
  const [users, stores, mfrs, txs, events, tests, claims, alerts] = await Promise.all([
    prisma.user.count(),
    prisma.store.count(),
    prisma.manufacturer.count(),
    prisma.transformer.count(),
    prisma.lifecycleEvent.count(),
    prisma.testRecord.count(),
    prisma.warrantyClaim.count(),
    prisma.alert.count(),
  ]);

  console.log(`
  Seed complete.
    Users .......... ${users}
    Stores ......... ${stores}
    Manufacturers .. ${mfrs}
    Transformers ... ${txs}
    Events ......... ${events}
    Test records ... ${tests}
    Warranty claims  ${claims}
    Alerts ......... ${alerts}

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
