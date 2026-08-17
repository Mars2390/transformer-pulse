import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * The workshop floor: who can work, who is working, and what is waiting.
 *
 * ---------------------------------------------------------------------------
 * Who counts as a technician
 * ---------------------------------------------------------------------------
 * A technician is an ACTIVE user whose storeId points at a Store with
 * kind = WORKSHOP. There is deliberately no WORKSHOP_TECHNICIAN role.
 *
 * A role in this system is a set of permissions and a set of URL prefixes, and
 * both are already correct for these people: they are store keepers, at a
 * workshop, doing store-keeper things to units in their custody. Adding a role
 * would mean a new entry in ROLE_AREAS, roleHome, movementsFor,
 * actionsSignedBy and the admin user form, all to express "this store keeper
 * works at a shed that repairs things" — which is exactly what Store.kind
 * already says. The schema's own comment on Store.kind makes the same argument
 * about not creating a second table; this is the same argument about not
 * creating a second role.
 *
 * The consequence worth knowing: to add a technician, an admin creates a store
 * keeper and assigns them to the workshop. No new screen.
 */

/** One job at a time. A technician holding this many IN_REPAIR jobs is busy. */
export const MAX_CONCURRENT_JOBS = 1;

export type Technician = {
  id: string;
  name: string;
  email: string;
  workshopId: string | null;
  workshopName: string | null;
  /** Jobs currently IN_REPAIR. Busy when this reaches MAX_CONCURRENT_JOBS. */
  activeJobs: number;
  available: boolean;
  /** What they are holding, for the "why is this person unavailable" line. */
  currentJob: { repairId: string; label: string; startedAt: Date | null } | null;
};

/**
 * Everyone who can be handed a bench job, with their current load.
 *
 * Scoped to one workshop when a workshopStoreId is given. Without it, every
 * workshop's technicians are returned — which is what an admin looking at the
 * whole estate wants, and never what a store manager should see.
 */
export async function listTechnicians(workshopStoreId?: string | null): Promise<Technician[]> {
  const users = await prisma.user.findMany({
    where: {
      active: true,
      // The role matters as much as the store. A STORE_MANAGER attached to a
      // workshop is its APPROVER, and listing them as assignable put the
      // checker in the maker's dropdown — one click from signing off their own
      // repair. The definition was always "a store keeper at a workshop"; this
      // is the half of it the query was missing.
      role: "STORE_KEEPER",
      store: {
        kind: "WORKSHOP",
        active: true,
        ...(workshopStoreId ? { id: workshopStoreId } : {}),
      },
    },
    select: {
      id: true,
      name: true,
      email: true,
      store: { select: { id: true, name: true } },
      repairsAssigned: {
        where: { status: "IN_REPAIR" },
        select: {
          id: true,
          startedAt: true,
          transformer: { select: { gNumber: true, serialNumber: true } },
        },
        orderBy: { startedAt: "asc" },
      },
    },
    orderBy: { name: "asc" },
  });

  return users.map((u) => {
    const job = u.repairsAssigned[0] ?? null;
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      workshopId: u.store?.id ?? null,
      workshopName: u.store?.name ?? null,
      activeJobs: u.repairsAssigned.length,
      available: u.repairsAssigned.length < MAX_CONCURRENT_JOBS,
      currentJob: job
        ? {
            repairId: job.id,
            label: job.transformer.gNumber ?? job.transformer.serialNumber,
            startedAt: job.startedAt,
          }
        : null,
    };
  });
}

export type WorkshopCounts = {
  queued: number;
  inRepair: number;
  repaired: number;
  beyondRepair: number;
  /** Everything not yet moved off the bench — queued + in repair. */
  onBench: number;
};

/**
 * The four numbers the board shows.
 *
 * REPAIRED and BEYOND_REPAIR are counted only while the unit is still
 * physically at the workshop, i.e. the repair has an outcome but the transformer
 * has not been moved out yet. A workshop that repaired two hundred units last
 * year does not have two hundred units on its floor, and a board that says so
 * is useless.
 */
export async function workshopCounts(where: Record<string, unknown> = {}): Promise<WorkshopCounts> {
  const rows = await prisma.repairRecord.groupBy({
    by: ["status"],
    where: { ...where, transformer: { status: "AT_WORKSHOP" } },
    _count: { _all: true },
  });

  const of = (s: string) => rows.find((r) => r.status === s)?._count._all ?? 0;
  const queued = of("QUEUED");
  const inRepair = of("IN_REPAIR");

  return {
    queued,
    inRepair,
    repaired: of("REPAIRED"),
    beyondRepair: of("BEYOND_REPAIR"),
    onBench: queued + inRepair,
  };
}

export type AssignmentRefusal = { ok: false; reason: string };
export type AssignmentApproval = { ok: true };

/**
 * May this technician take this job?
 *
 * Returns a REASON on refusal rather than a boolean, because every refusal here
 * has a specific cause a human needs to read: the job is already finished, the
 * technician is holding something else, they do not work at this workshop.
 * "Cannot assign" on its own sends somebody looking for a bug.
 */
export async function canAssign(
  repairId: string,
  technicianId: string,
): Promise<AssignmentRefusal | AssignmentApproval> {
  const [repair, technician] = await Promise.all([
    prisma.repairRecord.findUnique({
      where: { id: repairId },
      select: { id: true, status: true, workshopStoreId: true, repairCompletedAt: true },
    }),
    prisma.user.findUnique({
      where: { id: technicianId },
      select: {
        id: true,
        name: true,
        active: true,
        role: true,
        store: { select: { id: true, kind: true, name: true } },
        repairsAssigned: {
          where: { status: "IN_REPAIR" },
          select: { id: true, transformer: { select: { gNumber: true, serialNumber: true } } },
        },
      },
    }),
  ]);

  if (!repair) return { ok: false, reason: "That repair record no longer exists." };
  if (repair.repairCompletedAt || repair.status === "REPAIRED" || repair.status === "BEYOND_REPAIR") {
    return { ok: false, reason: "This job is already closed. Reopen it before reassigning." };
  }

  if (!technician) return { ok: false, reason: "That technician no longer exists." };
  if (!technician.active) return { ok: false, reason: `${technician.name} is no longer an active user.` };
  if (technician.role !== "STORE_KEEPER") {
    return {
      ok: false,
      reason: `${technician.name} approves work at this workshop rather than doing it. Assigning them would put the same person on both sides of the signature.`,
    };
  }
  if (technician.store?.kind !== "WORKSHOP") {
    return {
      ok: false,
      reason: `${technician.name} is not attached to a workshop. An admin assigns a store keeper to a workshop to make them a technician.`,
    };
  }
  if (repair.workshopStoreId && technician.store.id !== repair.workshopStoreId) {
    return {
      ok: false,
      reason: `${technician.name} works at ${technician.store.name}, and this unit is on another workshop's floor.`,
    };
  }

  // The one-job rule. Held here rather than in the route so the workshop board,
  // the API and any future bulk-assign all refuse for the same reason.
  const held = technician.repairsAssigned;
  if (held.length >= MAX_CONCURRENT_JOBS) {
    const busyWith = held[0]?.transformer;
    const label = busyWith ? (busyWith.gNumber ?? busyWith.serialNumber) : "another unit";
    return {
      ok: false,
      reason: `${technician.name} is already working on ${label}. A technician takes one transformer at a time — leave this one in the queue, or finish that job first.`,
    };
  }

  return { ok: true };
}
