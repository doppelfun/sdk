/** Config for standalone hollow stepped pyramid MML. */
export type PyramidGenConfig = {
  baseWidth: number;
  layers: number;
  blockSize: number;
  doorWidthBlocks: number;
  seed: number;
  cx: number;
  cz: number;
  cornerColors?: string[];
  cornerEmissionIntensity?: number;
};

export const DEFAULT_PYRAMID_CONFIG: PyramidGenConfig = {
  baseWidth: 20,
  layers: 10,
  blockSize: 2,
  doorWidthBlocks: 3,
  seed: 77,
  cx: 25,
  cz: 25,
};

const MAX_CORNER_COLORS = 32;

function clampCornerColors(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const s = item.trim();
    if (s.length > 0 && s.length <= 64) out.push(s);
    if (out.length >= MAX_CORNER_COLORS) break;
  }
  return out.length > 0 ? out : undefined;
}

function randomInt(max: number): number {
  return Math.floor(Math.random() * (max + 1));
}

export function clampPyramidConfig(c: Partial<PyramidGenConfig>): PyramidGenConfig {
  const n = (v: number | undefined, d: number, min: number, max: number) => {
    if (v == null || Number.isNaN(v)) return d;
    return Math.max(min, Math.min(max, v));
  };
  const base: PyramidGenConfig = {
    baseWidth: n(c.baseWidth, DEFAULT_PYRAMID_CONFIG.baseWidth, 4, 60),
    layers: n(c.layers, DEFAULT_PYRAMID_CONFIG.layers, 2, 30),
    blockSize: n(c.blockSize, DEFAULT_PYRAMID_CONFIG.blockSize, 0.5, 10),
    doorWidthBlocks: n(c.doorWidthBlocks, DEFAULT_PYRAMID_CONFIG.doorWidthBlocks, 1, 10),
    seed: n(c.seed, randomInt(2 ** 31 - 1), 0, 2 ** 31 - 1),
    cx: n(c.cx, 5 + randomInt(90), 0, 100),
    cz: n(c.cz, 5 + randomInt(90), 0, 100),
  };
  const cornerColors = clampCornerColors(c.cornerColors);
  if (cornerColors) base.cornerColors = cornerColors;
  if (c.cornerEmissionIntensity != null && Number.isFinite(c.cornerEmissionIntensity)) {
    base.cornerEmissionIntensity = Math.max(0.1, Math.min(20, c.cornerEmissionIntensity));
  }
  return base;
}
