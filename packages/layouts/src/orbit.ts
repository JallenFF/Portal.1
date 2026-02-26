// ============================================================
// Orbit Layout Strategy
// ============================================================
// Recency-based ring organization.
// Files are pushed outward from center based on last-used time.
// Newest items on inner rings, oldest on outer rings.
//
// Core is always empty (exclusion zone).
// Hash-anchored angles prevent jitter between frames.
// Ring buckets are configurable via config.params.
//
// This is a VIEW — it does not destroy free-mode positions.
// Switching to orbit computes new targets; switching back
// to free restores the user's manual arrangement.
// ============================================================

import type { Node, Edge, NodeId } from "../../core/src/types";
import type {
  LayoutStrategy, LayoutPosition, LayoutBody, LayoutConfig,
} from "./types";

// ------------------------------------------------------------
// Ring bucket definition
// ------------------------------------------------------------
export interface RingBucket {
  label: string;
  maxAgeMs: number;   // max age in milliseconds to belong to this ring
  radius: number;     // distance from project center
}

const DEFAULT_RING_BUCKETS: RingBucket[] = [
  { label: "0 – 24h",      maxAgeMs: 24 * 3600000,       radius: 80 },
  { label: "1 – 3 days",   maxAgeMs: 3 * 86400000,       radius: 150 },
  { label: "4 – 7 days",   maxAgeMs: 7 * 86400000,       radius: 220 },
  { label: "8 – 30 days",  maxAgeMs: 30 * 86400000,      radius: 290 },
  { label: "31 – 180 days", maxAgeMs: 180 * 86400000,    radius: 360 },
  { label: "180+ days",    maxAgeMs: Infinity,            radius: 430 },
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

function getRingIndex(ageMs: number, buckets: RingBucket[]): number {
  for (let i = 0; i < buckets.length; i++) {
    if (ageMs <= buckets[i].maxAgeMs) return i;
  }
  return buckets.length - 1;
}

// ------------------------------------------------------------
// Strategy
// ------------------------------------------------------------
export const orbitLayout: LayoutStrategy = {
  name: "orbit",
  label: "Orbit",
  usesPhysics: true,

  computePositions(
    nodes: Node[],
    _edges: Edge[],
    config: LayoutConfig,
  ): Record<NodeId, LayoutPosition> {
    const positions: Record<NodeId, LayoutPosition> = {};
    const buckets = (config.params.ringBuckets as RingBucket[]) ?? DEFAULT_RING_BUCKETS;
    const now = (config.params.now as number) ?? Date.now();
    const maxDepth = (config.params.maxDepthRings as number) ?? buckets.length;

    // Count nodes per ring for angular spacing
    const ringCounts: Map<number, number> = new Map();
    const nodeRings: Map<NodeId, number> = new Map();

    for (const node of nodes) {
      const age = now - node.lastUsedAt;
      const ring = getRingIndex(age, buckets);
      const clampedRing = Math.min(ring, maxDepth - 1);
      nodeRings.set(node.id, clampedRing);
      ringCounts.set(clampedRing, (ringCounts.get(clampedRing) || 0) + 1);
    }

    // Track how many we've placed per ring (for even angular spacing)
    const ringPlaced: Map<number, number> = new Map();

    for (const node of nodes) {
      const ringIdx = nodeRings.get(node.id)!;
      const bucket = buckets[Math.min(ringIdx, buckets.length - 1)];
      const count = ringCounts.get(ringIdx) || 1;
      const placed = ringPlaced.get(ringIdx) || 0;

      // Stable base angle from hash
      const baseAngle = (2 * Math.PI * (hashCode(node.id) % 10000)) / 10000;
      
      // Distribute evenly within the ring, offset by base angle
      const spacing = (2 * Math.PI) / Math.max(count, 1);
      const angle = baseAngle + placed * spacing * 0.3; // blend hash + even spacing

      const r = bucket.radius;

      positions[node.id] = {
        x: r * Math.cos(angle),
        y: r * Math.sin(angle),
        ring: ringIdx,
        angle,
      };

      ringPlaced.set(ringIdx, placed + 1);
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

      // Attraction to orbit target
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

      // File-file repulsion (within ring and cross-ring)
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

// Export ring buckets for renderer to draw circles
export { DEFAULT_RING_BUCKETS };
export type { RingBucket as RingBucketType };
