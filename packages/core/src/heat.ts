// ============================================================
// Portal Heat Scoring — Engine
// ============================================================
// Pure functions. No side effects. No DB access.
// Takes metadata + profile → returns score.
//
// Recalculation triggers (not continuous):
//   - Session start
//   - Project entry (re-entry zeroes project penalty)
//   - Periodic background tick (debounced, e.g. every 15 min)
//   - Explicit user action (re-sort, layout switch)
//
// Complexity: O(N) for heat update, O(N log N) for sort.
// No O(N²). No global pairwise anything.
// ============================================================

import type {
  HeatMetadata,
  HeatScore,
  HeatBreakdown,
  HeatTier,
  WeightProfile,
  TierThresholds,
  DecayConfig,
} from "./heat-types";
import {
  DEFAULT_TIER_THRESHOLDS,
  DEFAULT_DECAY_CONFIG,
  WEIGHT_PROFILES,
} from "./heat-types";

// ------------------------------------------------------------
// Core calculation
// ------------------------------------------------------------

/**
 * Calculate heat score for a single node.
 *
 * Heat = Σ(wₙ · Signalₙ) − StalenessPenalty
 * Clamped to [0, 100]. No negatives. No runaway.
 *
 * User overrides (pinned, archived) apply AFTER the formula
 * as hard clamps, so they always win.
 */
export function calculateHeat(
  meta: HeatMetadata,
  profile: WeightProfile,
  now: number = Date.now(),
  decay: DecayConfig = DEFAULT_DECAY_CONFIG,
): HeatScore {
  // ── 1. Direct Usage (0–100) ──────────────────────────
  const directUsage = computeDirectUsage(meta, now, decay);

  // ── 2. Project Inheritance (0–100) ───────────────────
  const projectInheritance = computeProjectInheritance(meta, now, decay);

  // ── 3. Structural Importance (0–100) ─────────────────
  const structuralImportance = computeStructuralImportance(meta);

  // ── 4. User Boost (0–100) ────────────────────────────
  const userBoost = computeUserBoost(meta);

  // ── 5. Staleness Penalty (0–100) ─────────────────────
  const stalenessPenalty = computeStalenessPenalty(meta, now, decay);

  // ── Weighted sum ─────────────────────────────────────
  const raw =
    profile.directUsage * directUsage +
    profile.projectInheritance * projectInheritance +
    profile.structuralImportance * structuralImportance +
    profile.userBoost * userBoost -
    profile.stalenessPenalty * stalenessPenalty;

  // ── Clamp ────────────────────────────────────────────
  let score = clamp(raw, 0, 100);

  // ── User overrides (hard clamps — user always wins) ──
  if (meta.archived) {
    score = Math.min(score, decay.archivedCeiling);
  }
  if (meta.pinned && !meta.archived) {
    score = Math.max(score, decay.pinnedFloor);
  }

  const tier = getTier(score);

  return {
    nodeId: meta.nodeId,
    score: Math.round(score * 100) / 100, // 2 decimal places
    tier,
    breakdown: {
      directUsage: round2(directUsage),
      projectInheritance: round2(projectInheritance),
      structuralImportance: round2(structuralImportance),
      userBoost: round2(userBoost),
      stalenessPenalty: round2(stalenessPenalty),
      profileName: profile.name,
    },
    computedAt: now,
  };
}

/**
 * Batch calculation for all nodes in a project (or globally).
 * Returns sorted by score descending (hottest first).
 * O(N) calculate + O(N log N) sort.
 */
export function calculateHeatBatch(
  metas: HeatMetadata[],
  profile: WeightProfile,
  now: number = Date.now(),
  decay: DecayConfig = DEFAULT_DECAY_CONFIG,
): HeatScore[] {
  const scores = metas.map((m) => calculateHeat(m, profile, now, decay));
  scores.sort((a, b) => b.score - a.score);
  return scores;
}

// ------------------------------------------------------------
// Signal computations (each returns 0–100)
// ------------------------------------------------------------

/**
 * Direct Usage: blends recency + frequency.
 *
 * Recency: exponential decay from last interaction.
 * Frequency: log-scaled open/edit count.
 *
 * Used today → ~90-100
 * Used 3 weeks ago → ~20-40
 * Used 20 times in 30 days → sustained boost
 */
function computeDirectUsage(
  meta: HeatMetadata,
  now: number,
  decay: DecayConfig,
): number {
  // Most recent interaction (opened or executed)
  const lastInteraction = Math.max(meta.lastOpened, meta.lastExecuted);

  // Recency: half-life decay
  const daysSince = Math.max(0, (now - lastInteraction) / 86400000);
  const halfLife = decay.usageHalfLifeDays;
  const recency = 100 * Math.pow(0.5, daysSince / halfLife);

  // Frequency: log-scaled, capped at 100
  const totalActions = meta.openCount + meta.editCount;
  const frequency = Math.min(100, 20 * Math.log2(totalActions + 1));

  // Blend: recency dominates (70/30)
  return 0.7 * recency + 0.3 * frequency;
}

/**
 * Project Inheritance: files inherit heat from their parent project.
 *
 * When you enter a project, project heat spikes.
 * When you leave, it decays by projectDecayPerDay.
 * Penalty is capped at maxProjectPenalty.
 *
 * This prevents "cold project collapse" — files in an active
 * project stay warm even if individually untouched.
 */
function computeProjectInheritance(
  meta: HeatMetadata,
  now: number,
  decay: DecayConfig,
): number {
  if (!meta.projectId || meta.projectLastActive === 0) {
    return 0; // unassigned nodes get no project heat
  }

  const daysAway = Math.max(0, (now - meta.projectLastActive) / 86400000);
  const penalty = Math.min(daysAway * decay.projectDecayPerDay, decay.maxProjectPenalty);

  // Start at 100 (just entered) and subtract penalty
  return Math.max(0, 100 - penalty);
}

/**
 * Structural Importance: files referenced by many others get
 * persistent heat. This keeps foundational files from drifting.
 *
 * reference_count + import_count → log-scaled score.
 * A README with 20 references stays in Reference tier
 * even with zero recent use.
 */
function computeStructuralImportance(meta: HeatMetadata): number {
  const totalRefs = meta.referenceCount + meta.importCount;
  if (totalRefs === 0) return 0;

  // Log scale: 1 ref = ~20, 5 refs = ~52, 20 refs = ~86, 50+ = ~100
  return Math.min(100, 20 * Math.log2(totalRefs + 1));
}

/**
 * User Boost: manual overrides that indicate importance.
 *
 * pinned = 100 (will be clamped to floor later anyway)
 * promoted/core = 60
 * locked = 40 (doesn't mean important, just means don't move)
 * nothing = 0
 */
function computeUserBoost(meta: HeatMetadata): number {
  if (meta.pinned) return 100;
  if (meta.promoted) return 60;
  if (meta.locked) return 40;
  return 0;
}

/**
 * Staleness Penalty: gradual decay for untouched files.
 * Intentionally weak — it's a tiebreaker, not a driver.
 *
 * Never instant. Smooth and bounded.
 * A file untouched for 90 days → penalty ~45
 * A file untouched for 30 days → penalty ~15
 * Maximum penalty = 60 (never fully kills a file alone)
 */
function computeStalenessPenalty(
  meta: HeatMetadata,
  now: number,
  _decay: DecayConfig,
): number {
  const lastInteraction = Math.max(
    meta.lastOpened,
    meta.lastExecuted,
    meta.projectLastActive,
  );

  if (lastInteraction === 0) return 60; // never interacted = max penalty

  const daysSince = Math.max(0, (now - lastInteraction) / 86400000);

  // Logarithmic curve: slow start, diminishing returns
  // 7 days → ~8, 30 days → ~15, 90 days → ~22, 365 days → ~30
  return Math.min(60, 10 * Math.log2(daysSince + 1));
}

// ------------------------------------------------------------
// Tier assignment
// ------------------------------------------------------------

export function getTier(
  score: number,
  thresholds: TierThresholds = DEFAULT_TIER_THRESHOLDS,
): HeatTier {
  if (score >= thresholds.active) return "active";
  if (score >= thresholds.reference) return "reference";
  if (score >= thresholds.dormant) return "dormant";
  return "cold";
}

/**
 * Get tier boundaries for a set of scores.
 * Returns counts and score ranges per tier.
 * Useful for the entropy meter and debug overlay.
 */
export function getTierSummary(
  scores: HeatScore[],
  thresholds: TierThresholds = DEFAULT_TIER_THRESHOLDS,
): Record<HeatTier, { count: number; minScore: number; maxScore: number }> {
  const summary: Record<HeatTier, { count: number; minScore: number; maxScore: number }> = {
    active: { count: 0, minScore: Infinity, maxScore: -Infinity },
    reference: { count: 0, minScore: Infinity, maxScore: -Infinity },
    dormant: { count: 0, minScore: Infinity, maxScore: -Infinity },
    cold: { count: 0, minScore: Infinity, maxScore: -Infinity },
  };

  for (const s of scores) {
    const tier = getTier(s.score, thresholds);
    summary[tier].count++;
    summary[tier].minScore = Math.min(summary[tier].minScore, s.score);
    summary[tier].maxScore = Math.max(summary[tier].maxScore, s.score);
  }

  // Clean up Infinity for empty tiers
  for (const tier of ["active", "reference", "dormant", "cold"] as HeatTier[]) {
    if (summary[tier].count === 0) {
      summary[tier].minScore = 0;
      summary[tier].maxScore = 0;
    }
  }

  return summary;
}

// ------------------------------------------------------------
// Profile helpers
// ------------------------------------------------------------

/** Get a built-in profile by key, or fall back to balanced. */
export function getProfile(name: string): WeightProfile {
  return WEIGHT_PROFILES[name] ?? WEIGHT_PROFILES.balanced;
}

/** Normalize weights so they sum to 1.0 (excluding staleness). */
export function normalizeProfile(p: WeightProfile): WeightProfile {
  const sum = p.directUsage + p.projectInheritance + p.structuralImportance + p.userBoost;
  if (sum === 0) return { ...WEIGHT_PROFILES.balanced };

  return {
    name: p.name,
    directUsage: p.directUsage / sum,
    projectInheritance: p.projectInheritance / sum,
    structuralImportance: p.structuralImportance / sum,
    userBoost: p.userBoost / sum,
    stalenessPenalty: p.stalenessPenalty, // penalty is separate
  };
}

// ------------------------------------------------------------
// Entropy integration
// ------------------------------------------------------------

/**
 * Compute entropy from heat scores.
 * E = (Dormant + Cold) / Total × 100
 *
 * 0–20%  = Focused (minimalist UI)
 * 21–50% = Stable (standard view)
 * >50%   = Cluttered (trigger archive suggestion)
 */
export function computeHeatEntropy(scores: HeatScore[]): {
  entropyPercent: number;
  status: "focused" | "stable" | "cluttered";
} {
  if (scores.length === 0) return { entropyPercent: 0, status: "focused" };

  const coldOrDormant = scores.filter(
    (s) => s.tier === "dormant" || s.tier === "cold",
  ).length;
  const entropyPercent = Math.round((coldOrDormant / scores.length) * 100);

  let status: "focused" | "stable" | "cluttered";
  if (entropyPercent <= 20) status = "focused";
  else if (entropyPercent <= 50) status = "stable";
  else status = "cluttered";

  return { entropyPercent, status };
}

// ------------------------------------------------------------
// Utilities
// ------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Create a default HeatMetadata for a node that has no tracking yet.
 * All signals at zero = cold tier.
 */
export function createDefaultHeatMetadata(
  nodeId: string,
  projectId: string | null = null,
): HeatMetadata {
  return {
    nodeId,
    projectId,
    lastOpened: 0,
    lastExecuted: 0,
    openCount: 0,
    editCount: 0,
    referenceCount: 0,
    importCount: 0,
    pinned: false,
    locked: false,
    promoted: false,
    archived: false,
    projectLastActive: 0,
  };
}
