/**
 * Config for procedural tree placement (m-model catalogIds).
 * Hyperscape procgen builds mesh trees; Doppel MML uses catalog models (e.g. def-tree, def-pine-trees).
 */
export type TreesGenConfig = {
  /** Number of trees (default 12). */
  count: number;
  /** Single catalogId or first of rotation (default def-tree). */
  catalogId: string;
  /** Optional extra catalogIds to pick from randomly per tree. */
  catalogIds?: string[];
  /** PRNG seed. */
  seed: number;
  /** Margin inside 0..100 (default 2). */
  margin: number;
  /** collide on m-model (default true). */
  collide: boolean;
};

export const DEFAULT_TREES_CONFIG: TreesGenConfig = {
  count: 12,
  catalogId: "def-tree",
  seed: 99,
  margin: 2,
  collide: true,
};

const BLOCK_MAX = 100;

export function clampTreesConfig(c: Partial<TreesGenConfig>): TreesGenConfig {
  const n = (v: number | undefined, d: number, min: number, max: number) => {
    if (v == null || Number.isNaN(v)) return d;
    return Math.max(min, Math.min(max, v));
  };
  const catalogId =
    typeof c.catalogId === "string" && c.catalogId.trim()
      ? c.catalogId.trim().slice(0, 128)
      : DEFAULT_TREES_CONFIG.catalogId;
  let catalogIds: string[] | undefined;
  if (Array.isArray(c.catalogIds) && c.catalogIds.length > 0) {
    catalogIds = c.catalogIds
      .filter((s) => typeof s === "string" && s.trim())
      .map((s) => s.trim().slice(0, 128));
    if (catalogIds.length === 0) catalogIds = undefined;
  }
  return {
    count: n(c.count, DEFAULT_TREES_CONFIG.count, 0, 200),
    catalogId,
    catalogIds,
    seed: n(c.seed, DEFAULT_TREES_CONFIG.seed, 0, 2 ** 31 - 1),
    margin: n(c.margin, DEFAULT_TREES_CONFIG.margin, 0, 20),
    collide: c.collide !== false,
  };
}

export function treesBlockBounds(cfg: TreesGenConfig): { min: number; max: number } {
  return { min: cfg.margin, max: BLOCK_MAX - cfg.margin };
}
