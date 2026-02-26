// ============================================================
// Deterministic Seeding
// ============================================================
// Generates initial positions from IDs using hash functions.
// No Math.random() anywhere — same input = same output.
//
// This ensures the simulation converges to the same layout
// every time, regardless of when it loads.
// ============================================================

import type { Project, Node, NodeId, ProjectId } from "../core/src/types";

/**
 * Deterministic hash → integer.
 * DJB2 variant, always returns positive.
 */
export function hashId(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Hash to angle [0, 2π).
 * Stable per ID — same ID always gets same angle.
 */
export function hashToAngle(id: string): number {
  return (2 * Math.PI * (hashId(id) % 100000)) / 100000;
}

/**
 * Hash to normalized float [0, 1).
 * Uses a different seed offset to avoid correlation with hashToAngle.
 */
export function hashToFloat(id: string, seed: number = 0): number {
  return (hashId(id + String(seed)) % 100000) / 100000;
}

// ------------------------------------------------------------
// Sphere seeding (top-level project positions)
// ------------------------------------------------------------
export interface SphereSeed {
  id: ProjectId;
  x: number;
  y: number;
  radius: number;
  theta: number;
  orbitalR: number;
}

export interface SphereSeederConfig {
  rMin: number;       // inner orbit radius (active projects)
  rMax: number;       // outer orbit radius (dormant projects)
  gamma: number;      // activity falloff exponent (2 = tight active cluster)
  rBase: number;      // minimum sphere radius
  rScale: number;     // scaling factor for item count → radius
  nMax: number;       // max items for radius calculation (prevents explosion)
}

export const DEFAULT_SPHERE_SEEDER_CONFIG: SphereSeederConfig = {
  rMin: 250,
  rMax: 900,
  gamma: 2,
  rBase: 45,
  rScale: 4.5,
  nMax: 20,
};

/**
 * Compute deterministic initial positions for project spheres.
 * 
 * Each sphere gets:
 *   - radius from item count (sqrt scaling)
 *   - orbital distance from activity score
 *   - angle from ID hash
 *   - position on that orbit
 */
export function seedSpheres(
  projects: Array<{ id: ProjectId; activity: number; itemCount: number }>,
  config: SphereSeederConfig = DEFAULT_SPHERE_SEEDER_CONFIG,
): SphereSeed[] {
  return projects.map((p) => {
    const n = Math.min(p.itemCount, config.nMax);
    const radius = config.rBase + config.rScale * Math.sqrt(n);
    const orbitalR = config.rMin + Math.pow(1 - p.activity, config.gamma) * (config.rMax - config.rMin);
    const theta = hashToAngle(p.id);
    
    return {
      id: p.id,
      x: orbitalR * Math.cos(theta),
      y: orbitalR * Math.sin(theta),
      radius,
      theta,
      orbitalR,
    };
  });
}

// ------------------------------------------------------------
// File seeding (node positions inside a project)
// ------------------------------------------------------------
export interface FileSeed {
  id: NodeId;
  x: number;
  y: number;
  angle: number;
}

/**
 * Compute deterministic scatter positions for files inside a sphere.
 * Used as initial positions for free-mode when no saved positions exist.
 */
export function seedFiles(
  nodeIds: NodeId[],
  sphereRadius: number,
  coreRadius: number,
): FileSeed[] {
  const usableRange = sphereRadius * 0.85 - coreRadius - 10;
  
  return nodeIds.map((id) => {
    const angle = hashToAngle(id);
    const distFrac = hashToFloat(id, 42);
    const dist = coreRadius + 20 + distFrac * usableRange;
    
    return {
      id,
      x: dist * Math.cos(angle),
      y: dist * Math.sin(angle),
      angle,
    };
  });
}
