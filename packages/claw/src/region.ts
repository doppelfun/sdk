/**
 * Region bounds for the claw. Matches engine convention: regionId "cx_cz", REGION_SIZE per side.
 * Used so build LLM places entities above y=0 and within the current region's grid.
 */

export const REGION_SIZE = 32;

export type RegionBounds = { xMin: number; xMax: number; zMin: number; zMax: number };

/** World bounds [xMin, xMax) and [zMin, zMax) for a region (e.g. "0_0" → x 0..32, z 0..32). */
export function getRegionBounds(regionId: string): RegionBounds {
  const parts = regionId.split("_").map(Number);
  const cx = Number.isFinite(parts[0]) ? parts[0] : 0;
  const cz = Number.isFinite(parts[1]) ? parts[1] : 0;
  return {
    xMin: cx * REGION_SIZE,
    xMax: (cx + 1) * REGION_SIZE,
    zMin: cz * REGION_SIZE,
    zMax: (cz + 1) * REGION_SIZE,
  };
}
