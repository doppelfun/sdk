/**
 * World/region constants for the claw. Must match @doppel-engine/schema (PLAY_AREA_*_M, REGION_SIZE).
 * Used so build LLM places entities above y=0 and within the space extent.
 */
export const REGION_SIZE = 100;
export const PLAY_AREA_WIDTH_M = 100;
export const PLAY_AREA_DEPTH_M = 100;

export type RegionBounds = { xMin: number; xMax: number; zMin: number; zMax: number };

export type SpaceExtent = { xMin: number; zMin: number; width: number; depth: number };

/** Default space extent: 0,0 to 100×100 m. Single source for build tools; must match schema getDefaultWorldExtent(). */
export function getSpaceExtent(): SpaceExtent {
  return { xMin: 0, zMin: 0, width: PLAY_AREA_WIDTH_M, depth: PLAY_AREA_DEPTH_M };
}

/** World bounds [xMin, xMax) and [zMin, zMax) for a region (e.g. "0_0" → x 0..100, z 0..100). */
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
