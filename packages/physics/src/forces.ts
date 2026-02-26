// ============================================================
// Reusable Force Functions
// ============================================================
// Primitive force calculations that layout strategies compose.
// Each function computes a single force type.
// Layouts combine them in their computeForces() method.
//
// All functions are pure: (inputs) → force vector.
// No state, no mutation.
// ============================================================

export interface Vec2 {
  x: number;
  y: number;
}

/** Distance between two points */
export function distance(a: Vec2, b: Vec2): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/** Unit vector from a to b. Returns zero vector if coincident. */
export function unitVector(a: Vec2, b: Vec2): Vec2 {
  const d = distance(a, b);
  if (d === 0) return { x: 0, y: 0 };
  return { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
}

/**
 * Spring attraction toward a target point.
 * F = k * (target - position)
 */
export function springAttraction(
  position: Vec2,
  target: Vec2,
  strength: number,
): Vec2 {
  return {
    x: strength * (target.x - position.x),
    y: strength * (target.y - position.y),
  };
}

/**
 * Repulsion between two bodies when closer than minDistance.
 * F = k * (minDist - d) * unitVec(other → self)
 * Returns force on body A (away from B).
 */
export function pairRepulsion(
  posA: Vec2,
  posB: Vec2,
  minDistance: number,
  strength: number,
): Vec2 {
  const dx = posA.x - posB.x;
  const dy = posA.y - posB.y;
  const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
  if (d >= minDistance) return { x: 0, y: 0 };
  const f = strength * (minDistance - d);
  return { x: f * (dx / d), y: f * (dy / d) };
}

/**
 * Radial exclusion from a center point.
 * If body is inside exclusionRadius, push it outward.
 */
export function coreExclusion(
  position: Vec2,
  center: Vec2,
  exclusionRadius: number,
  strength: number,
): Vec2 {
  const dx = position.x - center.x;
  const dy = position.y - center.y;
  const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
  if (d >= exclusionRadius) return { x: 0, y: 0 };
  const f = strength * (exclusionRadius - d);
  return { x: f * (dx / d), y: f * (dy / d) };
}

/**
 * Boundary constraint — pulls body inward if beyond radius.
 */
export function boundaryConstraint(
  position: Vec2,
  center: Vec2,
  radius: number,
  strength: number,
): Vec2 {
  const dx = position.x - center.x;
  const dy = position.y - center.y;
  const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
  if (d <= radius) return { x: 0, y: 0 };
  const f = strength * (d - radius);
  return { x: -f * (dx / d), y: -f * (dy / d) };
}

/**
 * Spring link between two bodies (bidirectional).
 * Pulls together if too far, pushes apart if too close.
 * Returns force on body A.
 */
export function springLink(
  posA: Vec2,
  posB: Vec2,
  desiredDistance: number,
  strength: number,
): Vec2 {
  const dx = posA.x - posB.x;
  const dy = posA.y - posB.y;
  const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
  const f = strength * (d - desiredDistance);
  return { x: -f * (dx / d), y: -f * (dy / d) };
}

/**
 * Gravity toward a center point. Always active, strength
 * decreases with distance. Useful for keeping the graph
 * from drifting into infinity.
 */
export function centerGravity(
  position: Vec2,
  center: Vec2,
  strength: number,
): Vec2 {
  return {
    x: strength * (center.x - position.x),
    y: strength * (center.y - position.y),
  };
}

/**
 * Sum multiple force vectors.
 */
export function sumForces(...forces: Vec2[]): Vec2 {
  let x = 0, y = 0;
  for (const f of forces) {
    x += f.x;
    y += f.y;
  }
  return { x, y };
}
