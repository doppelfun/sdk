/**
 * Position hint parsing for move approachPosition and build_incremental.
 */

export function parsePositionHint(hint: string): { x: number; y: number; z: number } | null {
  const parts = hint.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const x = Number(parts[0]);
  const z = Number(parts[parts.length - 1]);
  const y = parts.length >= 3 ? Number(parts[1]) : 0;
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(y)) return null;
  return { x, y, z };
}
