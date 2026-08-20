/**
 * The load alert generator.
 *
 * RULE, and it is the whole point of this file: an alert never calculates
 * anything. It reads the STORED derived snapshot and quotes it. Before this,
 * the generator took its own median across the upload while the API returned
 * the peak-load reading, so an alert could say 63% while the screen it linked
 * to said 42.72% about the same transformer on the same minute. Two numbers,
 * one truth, and an engineer left to guess which.
 *
 * Levels — loading, unbalance, phase percentage, neutral percentage, hot-spot —
 * come from the snapshot and nowhere else.
 *
 * Durations are the one exception, and deliberately so: "149 minutes above
 * rated" is not a level, it is a count of readings, and it cannot be read off a
 * single instant. Durations are passed in as an explicit window summary so it is
 * obvious in the signature which figures are instantaneous and which are not.
 */

import { LIMITS } from "./load-analysis";
import { unbalanceSeverity, snapshotArithmetic, type DerivedSnapshot } from "./analysis-snapshot";

/** Matches Prisma.AlertCreateManyInput for the fields this writes. */
export type LoadAlertInput = {
  transformerId: string;
  type: "SINGLE_PHASE_OVERLOAD" | "PHASE_UNBALANCE" | "NEUTRAL_CURRENT_HIGH" | "THD_HIGH";
  severity: "WARNING" | "CRITICAL";
  region: string | null;
  message: string;
};

/**
 * Duration facts about the upload window. Counts of readings, not levels.
 * Everything here is optional; omit it and the alerts simply say less.
 */
export type WindowDurations = {
  minutesAnyPhaseOverRated?: number;
  /** Minutes a phase was over rating while total kVA was still under nameplate. */
  hiddenOverloadMinutes?: number;
  longestExcursionMinutes?: number;
  minutesUnbalanceOver10?: number;
  minutesThdOverLimit?: number;
};

export type BuildLoadAlertsArgs = {
  transformerId: string;
  /** G-Number, or serial when the unit has not been booked in yet. */
  label: string;
  region: string | null;
  /** The stored derived snapshot. The only source of any level in the message. */
  snapshot: DerivedSnapshot;
  window?: WindowDurations;
};

const pct2 = (x: number) => x.toFixed(2) + "%";
const pct0 = (x: number) => x.toFixed(0) + "%";
const amps = (x: number) => x.toFixed(0) + " A";

/** The timestamp every message is anchored to, so alerts are checkable. */
function at(s: DerivedSnapshot): string {
  return s.recordedAt.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

export function buildLoadAlerts(args: BuildLoadAlertsArgs): LoadAlertInput[] {
  const { transformerId, label, region, snapshot: s } = args;
  const w = args.window ?? {};
  const out: LoadAlertInput[] = [];

  const base = { transformerId, region } as const;

  // --- Phase overload. Level from the snapshot, duration from the window. ---
  if (s.maxPhasePctRated >= LIMITS.phaseCritical * 100) {
    const dur =
      w.minutesAnyPhaseOverRated != null && w.minutesAnyPhaseOverRated > 0
        ? " Above rated for " + w.minutesAnyPhaseOverRated.toFixed(0) + " minute(s) across the upload" +
          (w.longestExcursionMinutes != null && w.longestExcursionMinutes > 0
            ? ", up to " + w.longestExcursionMinutes.toFixed(0) + " minutes unbroken."
            : ".")
        : "";
    const hidden =
      w.hiddenOverloadMinutes != null && w.hiddenOverloadMinutes > 0
        ? " For " + w.hiddenOverloadMinutes.toFixed(0) +
          " of those minutes the total kVA was still under nameplate — invisible to any kVA report."
        : "";
    out.push({
      ...base,
      type: "SINGLE_PHASE_OVERLOAD",
      severity: "CRITICAL",
      message:
        label + ": phase " + (s.hottestPhase ?? "?") + " at " + pct0(s.maxPhasePctRated) +
        " of its " + amps(s.ratedPhaseA) + " rating on a " + s.ratingKva + " kVA unit at " + at(s) +
        // The hot-spot quoted here is the one IN THAT WINDING. Quoting the
        // kVA-basis figure beside "phase at 122% of rated" would put two
        // numbers in one sentence that cannot both describe the same
        // transformer, and the reader would rightly disbelieve both.
        ". Hot-spot " + s.hotSpotByPhaseC.toFixed(2) + " degC in that winding, ageing " +
        s.ageingRateByPhase.toFixed(1) + "x normal. Total loading " + pct2(s.loadingPct) +
        ", which on its own would read " + s.hotSpotC.toFixed(2) + " degC." +
        dur + hidden,
    });
  } else if (s.maxPhasePctRated >= LIMITS.phaseWarn * 100) {
    out.push({
      ...base,
      type: "SINGLE_PHASE_OVERLOAD",
      severity: "WARNING",
      message:
        label + ": phase " + (s.hottestPhase ?? "?") + " at " + pct0(s.maxPhasePctRated) +
        " of rated current at " + at(s) + " (" + amps(s.maxPhaseA) + " against " +
        amps(s.ratedPhaseA) + "). Loading " + pct2(s.loadingPct) + ".",
    });
  }

  // --- Unbalance. THE value, straight off the snapshot, arithmetic shown. ---
  const unbSeverity = unbalanceSeverity(s.unbalancePct);
  if (unbSeverity !== "OK") {
    const dur =
      w.minutesUnbalanceOver10 != null && w.minutesUnbalanceOver10 > 0
        ? " Over 10% for " + w.minutesUnbalanceOver10.toFixed(0) + " minute(s) of the window."
        : "";
    out.push({
      ...base,
      type: "PHASE_UNBALANCE",
      severity: unbSeverity,
      message:
        label + ": current unbalance " + pct2(s.unbalancePct) + " at peak load (" + at(s) + "). " +
        snapshotArithmetic(s) + ". Adds " +
        ((s.unbalanceLossFactor - 1) * 100).toFixed(1) + "% to copper loss at this instant." + dur +
        " Rebalancing single-phase load is the cheapest fix available.",
    });
  }

  // --- Neutral. Snapshot level. ---
  if (s.neutralPctRated != null && s.neutralPctRated >= LIMITS.neutralWarn * 100) {
    out.push({
      ...base,
      type: "NEUTRAL_CURRENT_HIGH",
      severity: s.neutralPctRated >= LIMITS.neutralCritical * 100 ? "CRITICAL" : "WARNING",
      message:
        label + ": neutral carrying " + pct0(s.neutralPctRated) + " of rated phase current at " +
        at(s) + " (" + amps(s.neutralC ?? 0) + ", zero-sequence " +
        amps(s.zeroSequenceA ?? 0) + "). A balanced load returns almost none.",
    });
  }

  // --- THD. Snapshot level; duration from the window if supplied. ---
  if (s.thdPct != null && s.thdPct > LIMITS.thdCritical) {
    const dur =
      w.minutesThdOverLimit != null && w.minutesThdOverLimit > 0
        ? " Above " + LIMITS.thdVoltageLimit + "% for " + w.minutesThdOverLimit.toFixed(0) + " minute(s)."
        : "";
    out.push({
      ...base,
      type: "THD_HIGH",
      severity: "WARNING",
      message:
        label + ": harmonic distortion " + s.thdPct.toFixed(1) + "% at peak load (" + at(s) +
        "), above the " + LIMITS.thdVoltageLimit + "% IEEE 519 limit for low voltage." + dur,
    });
  }

  // --- Thermal. Reuses the phase-overload channel rather than inventing an
  // AlertType the enum does not have; the hot-spot is the reason, and it is in
  // the text where a reader will look for it.
  //
  // Judged on hotSpotByPhaseC, the HOTTEST WINDING, not on hotSpotC. The
  // hot-spot lives in the winding carrying the most current, and the kVA-basis
  // figure is close to the mean of the three phases — so on an unbalanced unit
  // it sits well below the temperature the paper is actually at. Testing the
  // kVA figure meant a transformer whose worst winding was at 129.8 degC, well
  // past the limit and ageing 39x normal, raised nothing at all because its
  // kVA-basis figure read 91.5 degC. Both numbers are in the message, because
  // the gap between them is the finding. ---
  if (s.hotSpotByPhaseC > LIMITS.hotspotC && !out.some((o) => o.type === "SINGLE_PHASE_OVERLOAD")) {
    out.push({
      ...base,
      type: "SINGLE_PHASE_OVERLOAD",
      severity: "CRITICAL",
      message:
        label + ": hot-spot " + s.hotSpotByPhaseC.toFixed(2) + " degC in the hottest winding (" +
        (s.hottestPhase ?? "worst phase") + " at " + pct2(s.maxPhasePctRated) + " of rated) at " +
        at(s) + ", above the " + LIMITS.hotspotC +
        " degC IEC 60076-7 limit for normal cyclic loading. On the kVA figure alone it reads " +
        s.hotSpotC.toFixed(2) + " degC, which is what a conventional report would show. Loading " +
        pct2(s.loadingPct) + ", unbalance " + pct2(s.unbalancePct) + ", ageing " +
        s.ageingRate.toFixed(1) + "x normal. Constants: " + s.constantsProvenance,
    });
  }

  return out;
}
