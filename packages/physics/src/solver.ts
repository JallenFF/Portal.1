// ============================================================
// Generic Physics Solver
// ============================================================
// A reusable force integrator. Any layout that sets
// usesPhysics = true uses this to step its bodies.
//
// The solver does NOT know about orbits, rings, or layout
// semantics. It just takes bodies + forces → new positions.
//
// Key properties:
//   - Pure function (no mutation, returns new array)
//   - Deterministic given same inputs
//   - Handles drag override (dragged bodies skip integration)
//   - Dynamic damping (configurable per call)
//   - Velocity capping (prevents explosion)
// ============================================================

import type { LayoutBody } from "../layouts/src/types";
import type { NodeId } from "../core/src/types";

export interface SolverConfig {
  /** Damping coefficient 0-1. Higher = more friction.
   *  Global view: ~0.88 (flicky). Local view: ~0.65 (grounded). */
  damping: number;

  /** Timestep. Default 1. Smaller = more stable, slower convergence. */
  dt: number;

  /** Max velocity per axis. Prevents physics explosion. */
  maxSpeed: number;

  /** Convergence threshold. If all velocities < this, simulation can sleep. */
  sleepThreshold: number;
}

export const DEFAULT_SOLVER_CONFIG: SolverConfig = {
  damping: 0.85,
  dt: 1,
  maxSpeed: 8,
  sleepThreshold: 0.05,
};

export interface SolverResult {
  bodies: LayoutBody[];
  /** True if all bodies have settled below sleep threshold */
  sleeping: boolean;
  /** Total kinetic energy (useful for debug/monitoring) */
  kineticEnergy: number;
}

/**
 * Step the physics simulation forward one frame.
 * 
 * @param bodies - Current body states
 * @param forces - Force vectors per node ID (from layout.computeForces)
 * @param config - Solver parameters
 * @returns New body states + sleep status
 */
export function solverStep(
  bodies: LayoutBody[],
  forces: Record<NodeId, { fx: number; fy: number }>,
  config: SolverConfig = DEFAULT_SOLVER_CONFIG,
): SolverResult {
  let totalKE = 0;
  let allSleeping = true;

  const next = bodies.map((body) => {
    // Dragged bodies: zero velocity, keep position
    if (body.dragging) {
      return { ...body, vx: 0, vy: 0 };
    }

    const f = forces[body.id] || { fx: 0, fy: 0 };

    // Velocity integration with damping
    let vx = config.damping * body.vx + config.dt * f.fx / body.mass;
    let vy = config.damping * body.vy + config.dt * f.fy / body.mass;

    // Velocity capping
    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed > config.maxSpeed) {
      vx *= config.maxSpeed / speed;
      vy *= config.maxSpeed / speed;
    }

    // Position integration
    const x = body.x + config.dt * vx;
    const y = body.y + config.dt * vy;

    // Kinetic energy
    const ke = 0.5 * body.mass * (vx * vx + vy * vy);
    totalKE += ke;

    if (speed > config.sleepThreshold) {
      allSleeping = false;
    }

    return { ...body, x, y, vx, vy };
  });

  return {
    bodies: next,
    sleeping: allSleeping,
    kineticEnergy: totalKE,
  };
}

/**
 * Create initial LayoutBody array from nodes + target positions.
 * Uses deterministic seeding — no Math.random().
 */
export function createBodies(
  nodes: Array<{ id: NodeId; width: number; height: number }>,
  targets: Record<NodeId, { x: number; y: number }>,
): LayoutBody[] {
  return nodes.map((node) => {
    const target = targets[node.id] || { x: 0, y: 0 };
    return {
      id: node.id,
      x: target.x,
      y: target.y,
      vx: 0,
      vy: 0,
      width: node.width,
      height: node.height,
      dragging: false,
      mass: 1,
    };
  });
}
