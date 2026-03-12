/**
 * Block slot bounds for the claw. Must match @doppel-engine/schema (BLOCK_SIZE_M, slot id "cx_cz").
 * MML builds must keep every entity x in [xMin, xMax) and z in [zMin, zMax) — see buildLlm.formatBoundsStrict.
 */
export const BLOCK_SIZE_M = 100;
export const PLAY_AREA_WIDTH_M = 100;
export const PLAY_AREA_DEPTH_M = 100;

export type BlockBounds = { xMin: number; xMax: number; zMin: number; zMax: number };

export type BlockExtent = { xMin: number; zMin: number; width: number; depth: number };

export function getBlockExtent(): BlockExtent {
  return { xMin: 0, zMin: 0, width: PLAY_AREA_WIDTH_M, depth: PLAY_AREA_DEPTH_M };
}

/** World bounds [xMin, xMax) and [zMin, zMax) for a block slot (e.g. "0_0"). */
export function getBlockBounds(blockSlotId: string): BlockBounds {
  const parts = blockSlotId.split("_").map(Number);
  const cx = Number.isFinite(parts[0]) ? parts[0]! : 0;
  const cz = Number.isFinite(parts[1]) ? parts[1]! : 0;
  return {
    xMin: cx * BLOCK_SIZE_M,
    xMax: (cx + 1) * BLOCK_SIZE_M,
    zMin: cz * BLOCK_SIZE_M,
    zMax: (cz + 1) * BLOCK_SIZE_M,
  };
}
