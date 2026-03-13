/**
 * Generic math helpers: angle normalization, lerp, and random range.
 * Used by movement/autonomous and any code that needs angle or random utils.
 */

/** Normalize angle (radians) to [-π, π]. */
export function normalizeAngle(angle: number): number {
  let out = angle;
  while (out > Math.PI) out -= Math.PI * 2;
  while (out < -Math.PI) out += Math.PI * 2;
  return out;
}

/** Linear interpolation between two angles (radians), shortest path. */
export function lerpAngle(current: number, target: number, t: number): number {
  const delta = normalizeAngle(target - current);
  return normalizeAngle(current + delta * t);
}

/** Random number in [min, max). */
export function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
