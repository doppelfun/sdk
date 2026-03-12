/**
 * Procedural tree placement → MML (m-model). Uses catalog ids like engine fixtures (def-tree, def-pine-trees).
 */
import { mulberry32, r2, deg } from "../shared/prng.js";
import type { TreesGenConfig } from "./config.js";
import { clampTreesConfig, treesBlockBounds } from "./config.js";

function pickCatalogId(cfg: TreesGenConfig, rng: () => number): string {
  const list =
    cfg.catalogIds && cfg.catalogIds.length > 0
      ? cfg.catalogIds
      : [cfg.catalogId];
  return list[Math.floor(rng() * list.length)]!;
}

/** Generate MML group of m-model trees on ground (y=0), random ry. */
export function generateTreesMml(config: Partial<TreesGenConfig> = {}): string {
  const c = clampTreesConfig(config);
  if (c.count <= 0) {
    return `<m-group id="trees-root">\n</m-group>`;
  }
  const rng = mulberry32(c.seed);
  const { min, max } = treesBlockBounds(c);
  const parts: string[] = [];
  const collideAttr = c.collide ? ' collide="true"' : "";

  for (let i = 0; i < c.count; i++) {
    const x = min + rng() * (max - min);
    const z = min + rng() * (max - min);
    const ry = rng() * Math.PI * 2;
    const id = `tree-${i}`;
    const catalogId = pickCatalogId(c, rng);
    parts.push(
      `  <m-model id="${id}" x="${r2(x)}" y="0" z="${r2(z)}" ry="${deg(ry)}" catalogId="${catalogId}"${collideAttr} />`
    );
  }
  return `<m-group id="trees-root">\n${parts.join("\n")}\n</m-group>`;
}

export function treesEntityCount(config: Partial<TreesGenConfig> = {}): number {
  return clampTreesConfig(config).count;
}
