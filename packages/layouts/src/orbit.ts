// ============================================================
// Orbit Layout Strategy — v2 (Heat-Based)
// ============================================================
// Ring placement is now driven by heat scores, not raw recency.
//
// v1: rings = time buckets (0-24h, 1-3d, etc.)
// v2: rings = heat tiers (active, reference, dormant, cold)
//
// The heat score is a blended signal of:
//   - Direct usage (recency + frequency)
//   - Project inheritance (active project boosts files)
//   - Structural importance (many references = persistent heat)
//   - User overrides (pinned, promoted)
//   - Staleness penalty (gentle decay)
//
// Orbit reads heat scores. It does NOT compute them.
// Heat engine runs separately on triggers (session start,
// project entry, background tick). Orbit just reads the result.
//
// POSITION RULES:
//   - Background decay updates SCORES, never positions
//   - Mid/outer rings can reorder on explicit user trigger
//   - Active ring positions respect user placement
//   - Workspace positions are sacred (never touched)
//
// This is a VIEW — switching to free restores manual arrangement.
// ============================================================

import type { Node, Edge, NodeId } from "../../core/src/types";
import type {
  LayoutStrategy, LayoutPosition, LayoutBody, LayoutConfig,
} from "./types";
import type { HeatScore, HeatTier } from "../../core/src/heat-types";
import { DEFAULT_TIER_THRESHOLDS } from "../../core/src/heat-types";

// ------------------------------------------------------------
// Ring definition (now by tier, not by time)
// ------------------------------------------------------------
export interface HeatRing {
  tier: HeatTier;
  label: string;
  radius: number;       // distance from project center
  iconScale: number;    // 1.0 = normal, 0.5 = small
  saturation: number;   // 1.0 = vivid, 0.3 = desaturated
}

const DEFAULT_HEAT_RINGS: HeatRing[] = [
  { tier: "active",    label: "Active",    radius: 90,  iconScale: 1.2, saturation: 1.0 },
  { tier: "reference", label: "Reference", radius: 200, iconScale: 1.0, saturation: 0.7 },
  { tier: "dormant",   label: "Dormant",   radius: 310, iconScale: 0.7, saturation: 0.4 },
  { tier: "cold",      label: "Cold Belt", radius: 400, iconScale: 0.4, saturation: 0.2 },
];

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function getRingForTier(tier: HeatTier, rings: HeatRing[]): HeatRing {
  return rings.find((r) => r.tier === tier) ?? rings[rings.length - 1];
}

/** Map ring tier to a numeric index for LayoutPosition.ring */
function tierToIndex(tier: HeatTier): number {
  switch (tier) {
    case "active": return 0;
    case "reference": return 1;
    case "dormant": return 2;
    case "cold": return 3;
  }
}

// ------------------------------------------------------------
// Strategy
// ------------------------------------------------------------
export const orbitLayout: LayoutStrategy = {
  name: "orbit",
  label: "Orbit",
  usesPhysics: true,

  /**
   * Compute target positions from heat scores.
   *
   * Expected config.params:
   *   - heatScores: Record<NodeId, HeatScore>  (required for v2)
   *   - heatRings: HeatRing[]                  (optional, uses defaults)
   *   - fallbackToRecency: boolean              (optional, true = v1 compat)
   *   - now: number                             (optional, defaults to Date.now())
   *
   * If heatScores is not provided and fallbackToRecency is true,
   * falls back to v1 time-based bucket placement for backward compat.
   */
  computePositions(
    nodes: Node[],
    _edges: Edge[],
    config: LayoutConfig,
  ): Record<NodeId, LayoutPosition> {
    const heatScores = config.params.heatScores as Record<NodeId, HeatScore> | undefined;
    const rings = (config.params.heatRings as HeatRing[]) ?? DEFAULT_HEAT_RINGS;
    const fallback = (config.params.fallbackToRecency as boolean) ?? true;

    // If no heat scores available, fall back to v1 recency
    if (!heatScores && fallback) {
      return computePositionsV1(nodes, config);
    }

    const positions: Record<NodeId, LayoutPosition> = {};

    // Group nodes by tier for angular spacing
    const tierGroups = new Map<HeatTier, Node[]>();
    for (const node of nodes) {
      const score = heatScores?.[node.id];
      const tier: HeatTier = score?.tier ?? "cold";
      if (!tierGroups.has(tier)) tierGroups.set(tier, []);
      tierGroups.get(tier)!.push(node);
    }

    // Place each group
    for (const [tier, group] of tierGroups) {
      const ring = getRingForTier(tier, rings);
      const count = group.length;

      // Sort within tier by score descending for consistent ordering
      if (heatScores) {
        group.sort((a, b) => {
          const sa = heatScores[a.id]?.score ?? 0;
          const sb = heatScores[b.id]?.score ?? 0;
          return sb - sa;
        });
      }

      for (let i = 0; i < group.length; i++) {
        const node = group[i];

        // Stable base angle from node ID hash
        const baseAngle = (2 * Math.PI * (hashCode(node.id) % 10000)) / 10000;

        // Distribute evenly, blended with hash for stability
        const spacing = (2 * Math.PI) / Math.max(count, 1);
        const angle = baseAngle + i * spacing * 0.3;

        // Slight radius variation by score within tier (hotter = slightly closer)
        const score = heatScores?.[node.id]?.score ?? 0;
        const tierScoreRange = 25; // each tier spans 25 points
        const tierBase = tier === "active" ? 75 : tier === "reference" ? 50 : tier === "dormant" ? 25 : 0;
        const normalizedInTier = tierScoreRange > 0
          ? (score - tierBase) / tierScoreRange
          : 0;
        const radiusVariance = ring.radius * 0.15; // ±15% within tier
        const r = ring.radius - normalizedInTier * radiusVariance;

        positions[node.id] = {
          x: r * Math.cos(angle),
          y: r * Math.sin(angle),
          ring: tierToIndex(tier),
          angle,
        };
      }
    }

    return positions;
  },

  computeForces(
    bodies: LayoutBody[],
    targets: Record<NodeId, LayoutPosition>,
    config: LayoutConfig,
  ): Record<NodeId, { fx: number; fy: number }> {
    const forces: Record<NodeId, { fx: number; fy: number }> = {};
    const coreR = config.coreRadius;
    const boundary = config.sphereRadius * config.focusInflation;

    const orbitAttract = (config.params.orbitAttractStrength as number) ?? 0.04;
    const coreRepel = (config.params.coreRepelStrength as number) ?? 2.0;
    const fileRepel = (config.params.fileRepelStrength as number) ?? 0.8;
    const boundaryStrength = (config.params.boundaryStrength as number) ?? 1.5;
    const minSeparation = (config.params.minSeparation as number) ?? 38;

    for (const body of bodies) {
      let fx = 0, fy = 0;

      if (body.dragging) {
        forces[body.id] = { fx: 0, fy: 0 };
        continue;
      }

      // Attraction to heat-based orbit target
      const target = targets[body.id];
      if (target) {
        fx += orbitAttract * (target.x - body.x);
        fy += orbitAttract * (target.y - body.y);
      }

      // Core exclusion (hard)
      const distToCenter = Math.sqrt(body.x * body.x + body.y * body.y) || 1;
      if (distToCenter < coreR + 15) {
        const push = coreRepel * (coreR + 15 - distToCenter);
        fx += push * (body.x / distToCenter);
        fy += push * (body.y / distToCenter);
      }

      // Boundary
      if (distToCenter > boundary) {
        const pull = boundaryStrength * (distToCenter - boundary);
        fx -= pull * (body.x / distToCenter);
        fy -= pull * (body.y / distToCenter);
      }

      // File-file repulsion
      for (const other of bodies) {
        if (other.id === body.id) continue;
        const dx = body.x - other.x;
        const dy = body.y - other.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        if (d < minSeparation) {
          const push = fileRepel * (minSeparation - d);
          fx += push * (dx / d);
          fy += push * (dy / d);
        }
      }

      forces[body.id] = { fx, fy };
    }

    return forces;
  },
};

// ------------------------------------------------------------
// v1 fallback (pure recency — backward compat)
// ------------------------------------------------------------

interface V1RingBucket {
  label: string;
  maxAgeMs: number;
  radius: number;
}

const V1_RING_BUCKETS: V1RingBucket[] = [
  { label: "0 – 24h",      maxAgeMs: 24 * 3600000,       radius: 80 },
  { label: "1 – 3 days",   maxAgeMs: 3 * 86400000,       radius: 150 },
  { label: "4 – 7 days",   maxAgeMs: 7 * 86400000,       radius: 220 },
  { label: "8 – 30 days",  maxAgeMs: 30 * 86400000,      radius: 290 },
  { label: "31 – 180 days", maxAgeMs: 180 * 86400000,    radius: 360 },
  { label: "180+ days",    maxAgeMs: Infinity,            radius: 430 },
];

function computePositionsV1(
  nodes: Node[],
  config: LayoutConfig,
): Record<NodeId, LayoutPosition> {
  const positions: Record<NodeId, LayoutPosition> = {};
  const buckets = (config.params.ringBuckets as V1RingBucket[]) ?? V1_RING_BUCKETS;
  const now = (config.params.now as number) ?? Date.now();

  const ringCounts = new Map<number, number>();
  const nodeRings = new Map<NodeId, number>();

  for (const node of nodes) {
    const age = now - node.lastUsedAt;
    let ring = buckets.length - 1;
    for (let i = 0; i < buckets.length; i++) {
      if (age <= buckets[i].maxAgeMs) { ring = i; break; }
    }
    nodeRings.set(node.id, ring);
    ringCounts.set(ring, (ringCounts.get(ring) || 0) + 1);
  }

  const ringPlaced = new Map<number, number>();
  for (const node of nodes) {
    const ringIdx = nodeRings.get(node.id)!;
    const bucket = buckets[ringIdx];
    const count = ringCounts.get(ringIdx) || 1;
    const placed = ringPlaced.get(ringIdx) || 0;

    const baseAngle = (2 * Math.PI * (hashCode(node.id) % 10000)) / 10000;
    const spacing = (2 * Math.PI) / Math.max(count, 1);
    const angle = baseAngle + placed * spacing * 0.3;

    positions[node.id] = {
      x: bucket.radius * Math.cos(angle),
      y: bucket.radius * Math.sin(angle),
      ring: ringIdx,
      angle,
    };

    ringPlaced.set(ringIdx, placed + 1);
  }

  return positions;
}

// Export ring definitions for renderer
export { DEFAULT_HEAT_RINGS };
export type { HeatRing };
