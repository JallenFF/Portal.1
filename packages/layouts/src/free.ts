// ============================================================
// Free Layout Strategy
// ============================================================
// Manual scatter inside the project sphere.
// User drags and drops; items stay where placed.
// 
// Physics: boundary constraint (required) + mild collision
// (optional). No orbit attraction, no forced organization.
//
// Positions persist — this IS the user's manual arrangement.
// ============================================================

import type { Node, Edge, NodeId } from "../../core/src/types";
import type {
  LayoutStrategy, LayoutPosition, LayoutBody, LayoutConfig,
} from "./types";

// Deterministic hash for initial scatter
function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export const freeLayout: LayoutStrategy = {
  name: "free",
  label: "Free",
  usesPhysics: true,

  computePositions(
    nodes: Node[],
    _edges: Edge[],
    config: LayoutConfig,
  ): Record<NodeId, LayoutPosition> {
    const positions: Record<NodeId, LayoutPosition> = {};
    const boundary = config.sphereRadius * config.focusInflation * 0.85;

    for (const node of nodes) {
      // Use persisted free position if available
      const saved = node.positions["free"];
      if (saved) {
        positions[node.id] = { x: saved.x, y: saved.y };
        continue;
      }

      // Deterministic initial scatter from hash
      const h = hashCode(node.id);
      const angle = (2 * Math.PI * (h % 10000)) / 10000;
      const dist = config.coreRadius + 20 + ((h % 1000) / 1000) * (boundary - config.coreRadius - 30);
      
      positions[node.id] = {
        x: dist * Math.cos(angle),
        y: dist * Math.sin(angle),
      };
    }

    return positions;
  },

  computeForces(
    bodies: LayoutBody[],
    targets: Record<NodeId, LayoutPosition>,
    config: LayoutConfig,
  ): Record<NodeId, { fx: number; fy: number }> {
    const forces: Record<NodeId, { fx: number; fy: number }> = {};
    const boundary = config.sphereRadius * config.focusInflation * 0.85;
    const coreR = config.coreRadius;

    // Params with defaults
    const collisionStrength = (config.params.collisionStrength as number) ?? 0.6;
    const boundaryStrength = (config.params.boundaryStrength as number) ?? 1.5;
    const coreRepelStrength = (config.params.coreRepelStrength as number) ?? 2.0;
    const attractStrength = (config.params.attractStrength as number) ?? 0.01;
    const minSeparation = (config.params.minSeparation as number) ?? 40;

    for (const body of bodies) {
      let fx = 0, fy = 0;

      if (body.dragging) {
        forces[body.id] = { fx: 0, fy: 0 };
        continue;
      }

      // Mild attraction to target (keeps nodes from drifting forever)
      const target = targets[body.id];
      if (target) {
        fx += attractStrength * (target.x - body.x);
        fy += attractStrength * (target.y - body.y);
      }

      // Core exclusion
      const distToCenter = Math.sqrt(body.x * body.x + body.y * body.y) || 1;
      if (distToCenter < coreR + 15) {
        const push = coreRepelStrength * (coreR + 15 - distToCenter);
        fx += push * (body.x / distToCenter);
        fy += push * (body.y / distToCenter);
      }

      // Boundary constraint
      if (distToCenter > boundary) {
        const pull = boundaryStrength * (distToCenter - boundary);
        fx -= pull * (body.x / distToCenter);
        fy -= pull * (body.y / distToCenter);
      }

      // File-file collision avoidance
      for (const other of bodies) {
        if (other.id === body.id) continue;
        const dx = body.x - other.x;
        const dy = body.y - other.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        if (d < minSeparation) {
          const push = collisionStrength * (minSeparation - d);
          fx += push * (dx / d);
          fy += push * (dy / d);
        }
      }

      forces[body.id] = { fx, fy };
    }

    return forces;
  },
};
