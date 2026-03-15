/**
 * Position/coordinate parsing. Accepts "x,z" or "x,y,z" (world coords).
 * Used by approach_position and build_incremental (position hint).
 */

export type Position3 = { x: number; y: number; z: number };

/** Parse "x,z" or "x,y,z" into { x, y, z }; y defaults to 0. Returns null if invalid. */
export function parsePositionHint(hint: string): Position3 | null {
  const parts = hint.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const x = Number(parts[0]);
  const z = Number(parts[parts.length - 1]);
  const y = parts.length >= 3 ? Number(parts[1]) : 0;
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(y)) return null;
  return { x, y, z };
}
