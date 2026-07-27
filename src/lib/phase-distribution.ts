import { PHASE_META, distributionStatus, type PhaseKey } from "@/lib/phase-colors";

/**
 * Per-phase customer estimates, for the "who is actually on this phase" view.
 *
 * This is a DIFFERENT estimate from the one the load-balancing panel already
 * uses (ASSUMED_CUSTOMER_AMPS = 5 A/customer, applied to an amperage to move).
 * That one answers "how many meters is 94 A". This one answers "how many
 * customers does this transformer serve in total, and how are they split
 * across phases right now" — driven by nameplate capacity rather than a
 * moment's current, per the brief: total customers ≈ kVA ÷ 0.8 kVA/customer,
 * and each phase's share follows its share of the measured current.
 *
 * Both are estimates and both say so. Neither is meter-level truth.
 */

export type PhaseDistributionRow = {
  phase: PhaseKey;
  amps: number;
  pctRated: number;
  status: { label: string; emoji: string; colour: string };
  estimatedCustomers: number;
  avgAmpsPerCustomer: number;
  deltaAmps: number;
  recommendation: string;
  /** Customers this phase should give up (>0) or receive (<0), if any. */
  recommendedMoveCustomers: number;
};

export type PhaseDistribution = {
  estimatedTotalCustomers: number;
  phases: PhaseDistributionRow[];
  heaviest: PhaseDistributionRow;
};

/** Typical Kenyan residential connection at nameplate — see load-analysis brief. */
const KVA_PER_CUSTOMER = 0.8;

export function estimateTotalCustomers(ratingKva: number): number {
  return Math.max(0, Math.round(ratingKva / KVA_PER_CUSTOMER));
}

export function computePhaseDistribution({
  currents,
  ratedPhaseA,
  ratingKva,
}: {
  currents: { l1: number; l2: number; l3: number };
  ratedPhaseA: number;
  ratingKva: number;
}): PhaseDistribution {
  const total = currents.l1 + currents.l2 + currents.l3;
  const estimatedTotalCustomers = estimateTotalCustomers(ratingKva);
  const target = total / 3;

  const base = (["l1", "l2", "l3"] as const).map((k) => {
    const phase = k.toUpperCase() as PhaseKey;
    const amps = currents[k];
    const pctRated = ratedPhaseA > 0 ? (amps / ratedPhaseA) * 100 : 0;
    const estimatedCustomers = total > 0 ? Math.round((amps / total) * estimatedTotalCustomers) : 0;
    const avgAmpsPerCustomer = estimatedCustomers > 0 ? amps / estimatedCustomers : 0;
    return { phase, amps, pctRated, estimatedCustomers, avgAmpsPerCustomer, deltaAmps: amps - target };
  });

  // Greedy giver→taker matching, same shape as the load-balancing plan, but
  // used here only to word a per-phase recommendation in customers.
  const givers = base.filter((r) => r.deltaAmps > 0.5).map((r) => ({ ...r })).sort((a, b) => b.deltaAmps - a.deltaAmps);
  const takers = base.filter((r) => r.deltaAmps < -0.5).map((r) => ({ ...r })).sort((a, b) => a.deltaAmps - b.deltaAmps);

  const movesIntoTaker = new Map<PhaseKey, { from: PhaseKey; customers: number }[]>();
  const movesFromGiver = new Map<PhaseKey, { to: PhaseKey; customers: number }[]>();
  let gi = 0, ti = 0;
  while (gi < givers.length && ti < takers.length) {
    const g = givers[gi], t = takers[ti];
    const ampsAvailable = g.deltaAmps;
    const ampsNeeded = -t.deltaAmps;
    const amt = Math.min(ampsAvailable, ampsNeeded);
    if (amt > 0.5) {
      const custs = g.avgAmpsPerCustomer > 0 ? Math.round(amt / g.avgAmpsPerCustomer) : 0;
      if (custs > 0) {
        if (!movesIntoTaker.has(t.phase)) movesIntoTaker.set(t.phase, []);
        movesIntoTaker.get(t.phase)!.push({ from: g.phase, customers: custs });
        if (!movesFromGiver.has(g.phase)) movesFromGiver.set(g.phase, []);
        movesFromGiver.get(g.phase)!.push({ to: t.phase, customers: custs });
      }
    }
    g.deltaAmps -= amt;
    t.deltaAmps += amt;
    if (g.deltaAmps <= 0.5) gi++;
    if (t.deltaAmps >= -0.5) ti++;
  }

  const phases: PhaseDistributionRow[] = base.map((r) => {
    const status = distributionStatus(r.pctRated);
    let recommendation: string;
    let recommendedMoveCustomers = 0;

    if (movesFromGiver.has(r.phase)) {
      const moves = movesFromGiver.get(r.phase)!;
      const totalCustomers = moves.reduce((s, m) => s + m.customers, 0);
      const toPhrase = moves.map((m) => PHASE_META[m.to].word).join(" and ");
      const urgent = r.pctRated >= 100 ? " NOW" : "";
      recommendedMoveCustomers = totalCustomers;
      recommendation = totalCustomers > 0
        ? `${r.pctRated >= 100 ? "Move" : "Minor — move"} ~${totalCustomers} customers to ${toPhrase} Phase${urgent}`
        : "Balanced — no action needed";
    } else if (movesIntoTaker.has(r.phase)) {
      const moves = movesIntoTaker.get(r.phase)!;
      const totalCustomers = moves.reduce((s, m) => s + m.customers, 0);
      const fromPhrase = moves.map((m) => PHASE_META[m.from].word).join(" and ");
      recommendedMoveCustomers = -totalCustomers;
      recommendation = totalCustomers > 0
        ? `Move ~${totalCustomers} customers from ${fromPhrase} Phase to here`
        : "Balanced — no action needed";
    } else {
      recommendation = "Balanced — no action needed";
    }

    return { ...r, status, recommendation, recommendedMoveCustomers };
  });

  const heaviest = phases.reduce((a, b) => (b.pctRated > a.pctRated ? b : a), phases[0]);

  return { estimatedTotalCustomers, phases, heaviest };
}
