/**
 * KPLC standard R-Y-B phase colour coding, used everywhere a phase is drawn or
 * named — map popups, load-balancing bars, banners, and exports. One table so
 * a colour or a label can never drift between screens.
 */

export type PhaseKey = "L1" | "L2" | "L3";

export const PHASE_META: Record<PhaseKey, { colour: string; word: string; label: string; dot: string }> = {
  L1: { colour: "#bb133e", word: "Red", label: "L1 (Red Phase)", dot: "🔴" },
  L2: { colour: "#f59e0b", word: "Yellow", label: "L2 (Yellow Phase)", dot: "🟡" },
  L3: { colour: "#0066cc", word: "Blue", label: "L3 (Blue Phase)", dot: "🔵" },
};

export const NEUTRAL_META = { colour: "#4b5563", word: "Neutral", label: "Neutral", dot: "⚫" };

export function phaseLabel(key: PhaseKey): string {
  return PHASE_META[key].label;
}

export function phaseColour(key: PhaseKey): string {
  return PHASE_META[key].colour;
}

/** Loading-severity colour for bars approaching rated current (80/100% bands). */
export function loadSeverityColour(pctRated: number): string {
  return pctRated >= 100 ? "#dc2626" : pctRated >= 80 ? "#d97706" : "#0e8a4f";
}

/**
 * Phase-distribution status band — how a phase's SHARE of the load compares
 * to what a balanced phase would carry, not how close it is to tripping.
 * A phase can be a healthy 60% of rated and still be "under-utilized" if its
 * sister phase is at 120%; that imbalance, not the raw percentage, is the
 * finding this band exists to name.
 */
export function distributionStatus(pctRated: number): { label: string; emoji: string; colour: string } {
  if (pctRated >= 100) return { label: "CRITICALLY OVERLOADED", emoji: "🔴", colour: "#dc2626" };
  if (pctRated >= 40) return { label: "NORMAL", emoji: "✅", colour: "#0e8a4f" };
  return { label: "UNDER-UTILIZED", emoji: "⚠️", colour: "#d97706" };
}
