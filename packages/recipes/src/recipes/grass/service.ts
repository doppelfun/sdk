/**
 * Recipe grass patches → MML (m-grass).
 */
import { mulberry32, r2 } from "./prng.js";
import type { GrassGenConfig } from "./config.js";
import { clampGrassConfig } from "./config.js";

const BLOCK_SIZE = 100;

const NEON_GRASS: [string, string][] = [
  ["#00ff88", "#004422"],
  ["#00ffaa", "#004433"],
  ["#88ffaa", "#224433"],
  ["#00ffcc", "#003322"],
  ["#50ff90", "#113322"],
];

export function generateGrassMml(config: Partial<GrassGenConfig> = {}): string {
  const c = clampGrassConfig(config);
  if (c.patches <= 0) {
    return `<m-group id="grass-root">\n</m-group>`;
  }
  const rng = mulberry32(c.seed);
  const parts: string[] = [];
  for (let p = 0; p < c.patches; p++) {
    const spread =
      c.spreadMin + rng() * (c.spreadMax - c.spreadMin || 1);
    const spaceW = BLOCK_SIZE - 2 * c.margin;
    const spaceD = BLOCK_SIZE - 2 * c.margin;
    const x =
      c.margin + rng() * Math.max(0.1, spaceW - spread);
    const z =
      c.margin + rng() * Math.max(0.1, spaceD - spread);
    const [color, colorDark] = NEON_GRASS[Math.floor(rng() * NEON_GRASS.length)]!;
    let attrs =
      `id="grass-${p}" x="${r2(x)}" y="${r2(c.y)}" z="${r2(z)}"` +
      ` count="${Math.floor(c.count)}" spread-x="${r2(spread)}" spread-z="${r2(spread)}" height="${r2(c.height)}"` +
      ` color="${color}" color-dark="${colorDark}"`;
    if (c.emissionIntensity > 0) {
      attrs += ` emission="${color}" emission-intensity="${r2(c.emissionIntensity)}"`;
    }
    parts.push(`  <m-grass ${attrs} />`);
  }
  return `<m-group id="grass-root">\n${parts.join("\n")}\n</m-group>`;
}

function getParams(raw: Record<string, unknown>): Record<string, unknown> {
  const p = raw.params;
  if (p && typeof p === "object" && !Array.isArray(p)) return p as Record<string, unknown>;
  return {};
}

export function run(raw: Record<string, unknown>): string {
  const p = getParams(raw);
  const cfg = clampGrassConfig({
    patches: typeof p.patches === "number" ? p.patches : undefined,
    count: typeof p.count === "number" ? p.count : undefined,
    spreadMin: typeof p.spreadMin === "number" ? p.spreadMin : undefined,
    spreadMax: typeof p.spreadMax === "number" ? p.spreadMax : undefined,
    height: typeof p.height === "number" ? p.height : undefined,
    y: typeof p.y === "number" ? p.y : undefined,
    seed: typeof p.seed === "number" ? p.seed : undefined,
    margin: typeof p.margin === "number" ? p.margin : undefined,
    emissionIntensity:
      typeof p.emissionIntensity === "number"
        ? p.emissionIntensity
        : typeof p.emission_intensity === "number"
          ? p.emission_intensity
          : undefined,
  });
  return generateGrassMml(cfg);
}
