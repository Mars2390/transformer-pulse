import type {
  EventType,
  TransformerStatus,
  TestStage,
} from "@/generated/prisma/enums";

/**
 * The serialisable shape of a transformer's story.
 *
 * Everything here is a primitive or plain object — no Date, no Decimal, no
 * Prisma model — because this data crosses from the server page into client tab
 * components, and only serialisable values survive that boundary.
 */

export type StoryTest = {
  id: string;
  stage: TestStage;
  passed: boolean;
  testedAt: string; // ISO
  insulationResistanceHvMohm: number | null;
  insulationResistanceLvMohm: number | null;
  turnsRatio: number | null;
  turnsRatioDeviationPct: number | null;
  windingResistanceHvOhm: number | null;
  windingResistanceLvOhm: number | null;
  oilBdvKv: number | null;
  oilTempC: number | null;
  ambientTempC: number | null;
  polarityOk: boolean | null;
  remarks: string | null;
};

export type StoryEvent = {
  id: string;
  type: EventType;
  fromStatus: TransformerStatus | null;
  toStatus: TransformerStatus;
  userName: string;
  userRole: string;
  occurredAt: string; // ISO
  createdAt: string; // ISO
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  locationName: string | null;
  vehiclePlate: string | null;
  driverName: string | null;
  driverPhone: string | null;
  destination: string | null;
  photoUrls: string[];
  notes: string | null;
  hash: string;
  prevHash: string | null;
  test: StoryTest | null;
};

export type StoryClaim = {
  id: string;
  status: string;
  faultReason: string;
  claimValueKes: number | null;
  referenceNo: string | null;
  manufacturerName: string;
};

export type StoryData = {
  id: string;
  serialNumber: string;
  gNumber: string | null;
  manufacturerName: string;
  ratingKva: number;
  primaryKv: number;
  secondaryKv: number;
  phases: number;
  coolingType: string;
  vectorGroup: string | null;
  yearOfManufacture: number;
  status: TransformerStatus;
  currentSiteName: string | null;
  feeder: string | null;
  region: string | null;
  warrantyStart: string | null; // ISO
  warrantyMonths: number;
  events: StoryEvent[]; // newest first
  claims: StoryClaim[];
};
