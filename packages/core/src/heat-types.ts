// ============================================================
// Portal Heat Scoring — Types
// ============================================================
// Heat is a single scalar score (0–100) per node that determines:
//   - Orbit ring placement (inner = hot, outer = cold)
//   - Visibility priority
//   - Compression eligibility
//   - Tier assignment (active / reference / dormant / cold)
//
// Heat is computed from tracked behavior signals.
// It is not visual. It is not physics. It is just ranking.
//
// Design rules:
//   - Weighted sum (additive), not multiplicative
//   - A zero in one signal does NOT tank the whole score
//   - Clamped 0–100, no negatives, no runaway growth
//   - Weight profiles are swappable at runtime (config, not code)
//   - Background decay updates SCORES only, never positions
//   - Mid/outer rings can reorder on explicit user trigger
//   - Inner ring + workspace positions are sacred (user-placed)
// ============================================================

import type { NodeId, ProjectId } from "./types";

// ------------------------------------------------------------
// Heat Tiers
// ------------------------------------------------------------
/**
 * Tier boundaries on the 0–100 heat scale.
 * Determines orbit ring assignment and visual treatment.
 *
 * Active (75–100):    Center orbit. Large icons, high saturation.
 * Reference (50–74):  Mid orbit. Standard size, medium glow.
 * Dormant (25–49):    Outer orbit. Small icons, desaturated.
 * Cold (0–24):        Belt. Tiny dots or compressed cluster.
 */
export type HeatTier = "active" | "reference" | "dormant" | "cold";

export interface TierThresholds {
  active: number;     // >= this = active (default 75)
  reference: number;  // >= this = reference (default 50)
  dormant: number;    // >= this = dormant (default 25)
  // below dormant = cold
}

export const DEFAULT_TIER_THRESHOLDS: TierThresholds = {
  active: 75,
  reference: 50,
  dormant: 25,
};

// ------------------------------------------------------------
// Weight Profile
// ------------------------------------------------------------
/**
 * A weight profile determines how signals blend into the final
 * heat score. Profiles are swappable at runtime — same data,
 * different ranking.
 *
 * All weights should sum to ~1.0 (the staleness penalty is
 * subtracted, not added, so it's separate).
 *
 * Weights are normalized internally so they always sum correctly
 * even if the user tweaks sliders.
 */
export interface WeightProfile {
  name: string;
  directUsage: number;            // w1: opened, edited, executed, referenced
  projectInheritance: number;     // w2: heat inherited from parent project
  structuralImportance: number;   // w3: reference_count, import_count, core tag
  userBoost: number;              // w4: pinned, locked, promoted
  stalenessPenalty: number;       // w5: subtracted; time since last interaction
}

// Built-in profiles
export const WEIGHT_PROFILES: Record<string, WeightProfile> = {
  balanced: {
    name: "Balanced",
    directUsage: 0.40,
    projectInheritance: 0.20,
    structuralImportance: 0.15,
    userBoost: 0.20,
    stalenessPenalty: 0.05,
  },
  usageHeavy: {
    name: "Usage Heavy",
    directUsage: 0.55,
    projectInheritance: 0.15,
    structuralImportance: 0.10,
    userBoost: 0.15,
    stalenessPenalty: 0.05,
  },
  projectContext: {
    name: "Project Context",
    directUsage: 0.25,
    projectInheritance: 0.35,
    structuralImportance: 0.15,
    userBoost: 0.20,
    stalenessPenalty: 0.05,
  },
  structural: {
    name: "Structural",
    directUsage: 0.25,
    projectInheritance: 0.15,
    structuralImportance: 0.35,
    userBoost: 0.20,
    stalenessPenalty: 0.05,
  },
};

// ------------------------------------------------------------
// Heat Metadata (tracked per node)
// ------------------------------------------------------------
/**
 * Minimal metadata tracked per node for heat calculation.
 * v1 reality: this is enough to beat traditional file systems.
 * Everything else evolves later.
 */
export interface HeatMetadata {
  nodeId: NodeId;
  projectId: ProjectId | null;

  // Direct usage signals
  lastOpened: number;       // ms epoch — last time file was opened
  lastExecuted: number;     // ms epoch — last time file was run/launched
  openCount: number;        // total opens in tracking window
  editCount: number;        // total edits in tracking window

  // Structural signals
  referenceCount: number;   // how many other nodes link to this
  importCount: number;      // how many nodes import/depend on this

  // User overrides
  pinned: boolean;          // minimum heat floor
  locked: boolean;          // excluded from auto-movement
  promoted: boolean;        // slow decay (core file)
  archived: boolean;        // heat forced near zero

  // Project-level context
  projectLastActive: number; // ms epoch — last time anyone entered parent project
}

// ------------------------------------------------------------
// Heat Score (computed result)
// ------------------------------------------------------------
/**
 * The computed heat score for a node.
 * This is the output of calculateHeat().
 */
export interface HeatScore {
  nodeId: NodeId;
  score: number;            // 0–100, clamped
  tier: HeatTier;
  breakdown: HeatBreakdown;
  computedAt: number;       // ms epoch when this was calculated
}

/**
 * Breakdown of how the score was computed.
 * Useful for debugging and the dev overlay.
 */
export interface HeatBreakdown {
  directUsage: number;      // 0–100 raw signal before weighting
  projectInheritance: number;
  structuralImportance: number;
  userBoost: number;
  stalenessPenalty: number;
  profileName: string;
}

// ------------------------------------------------------------
// Decay Config
// ------------------------------------------------------------
/**
 * Controls how heat decays over time.
 * Decay is slow, smooth, bounded, and never instant.
 */
export interface DecayConfig {
  /** How quickly direct usage signal decays (higher = faster fade) */
  usageHalfLifeDays: number;    // default 14 — usage signal halves every 14 days

  /** How quickly project context decays when you leave */
  projectDecayPerDay: number;   // default 2 — lose 2 heat points per day away

  /** Maximum project penalty (don't crush everything to zero) */
  maxProjectPenalty: number;    // default 30 — cap the project absence penalty

  /** Minimum heat floor for pinned items */
  pinnedFloor: number;          // default 60 — pinned items stay at least Reference

  /** Heat value for archived items */
  archivedCeiling: number;      // default 5 — archived items are effectively cold
}

export const DEFAULT_DECAY_CONFIG: DecayConfig = {
  usageHalfLifeDays: 14,
  projectDecayPerDay: 2,
  maxProjectPenalty: 30,
  pinnedFloor: 60,
  archivedCeiling: 5,
};
