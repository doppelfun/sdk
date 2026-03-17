/**
 * Recipe tree placement → MML (m-model).
 */
import { mulberry32, r2, deg } from "./prng.js";
import type { TreesGenConfig } from "./config.js";
import { clampTreesConfig, treesBlockBounds } from "./config.js";

function pickCatalogId(cfg: TreesGenConfig, rng: () => number): string {
  const list =
    cfg.catalogIds && cfg.catalogIds.length > 0
      ? cfg.catalogIds
      : [cfg.catalogId];
  return list[Math.floor(rng() * list.length)]!;
}

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

function getParams(raw: Record<string, unknown>): Record<string, unknown> {
  const p = raw.params;
  if (p && typeof p === "object" && !Array.isArray(p)) return p as Record<string, unknown>;
  return {};
}

export function run(raw: Record<string, unknown>): string {
  const p = getParams(raw);
  const catalogIds = Array.isArray(p.catalogIds)
    ? p.catalogIds
    : Array.isArray(p.catalog_ids)
      ? p.catalog_ids
      : undefined;
  const cfg = clampTreesConfig({
    count: typeof p.count === "number" ? p.count : undefined,
    catalogId: typeof p.catalogId === "string" ? p.catalogId : undefined,
    catalogIds: catalogIds as string[] | undefined,
    seed: typeof p.seed === "number" ? p.seed : undefined,
    margin: typeof p.margin === "number" ? p.margin : undefined,
    collide: typeof p.collide === "boolean" ? p.collide : undefined,
  });
  return generateTreesMml(cfg);
}
