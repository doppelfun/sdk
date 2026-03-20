/** Block size in meters; positions are block-local 0–100. */
export const BLOCK_SIZE_M = 100;

export type BlockBounds = {
  xMin: number;
  zMin: number;
  xMax: number;
  zMax: number;
};

/** MML is always block-local [0, 100). Return bounds for build prompts. */
export function getBlockBounds(_blockSlotId: string): BlockBounds {
  return { xMin: 0, zMin: 0, xMax: BLOCK_SIZE_M, zMax: BLOCK_SIZE_M };
}
