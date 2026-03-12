/** Config for standalone hollow stepped pyramid MML. */
export type PyramidGenConfig = {
  /** Base width in metres (default 20). */
  baseWidth: number;
  /** Number of stepped layers (default 10). */
  layers: number;
  /** Size of each cube block in metres (default 2). */
  blockSize: number;
  /** Doorway width in blocks (default 3). */
  doorWidthBlocks: number;
  /** PRNG seed (default 77). */
  seed: number;
  /** Centre X in block space (default 25). */
  cx: number;
  /** Centre Z in block space (default 25). */
  cz: number;
  /**
   * Optional palette for emissive corner cubes. If omitted, one random color is chosen for the whole pyramid (all corners match).
   * If one entry, every corner uses that color. If multiple, corners are mapped in stable order:
   * (bx=0,bz=0), (bx=max,bz=0), (bx=0,bz=max), (bx=max,bz=max) — then cycles if more layers/corners than colors.
   */
  cornerColors?: string[];
  /**
   * If set, fixed emission-intensity for all corner cubes. If omitted, intensity stays random per block (approx 3–7).
   */
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

/** Random int in [0, max] when caller omits seed/cx/cz (each generate differs). */
function randomInt(max: number): number {
  return Math.floor(Math.random() * (max + 1));
}

export function clampPyramidConfig(c: Partial<PyramidGenConfig>): PyramidGenConfig {
  const n = (v: number | undefined, d: number, min: number, max: number) => {
    if (v == null || Number.isNaN(v)) return d;
    return Math.max(min, Math.min(max, v));
  };
  // Omitted seed/cx/cz → random defaults; pass explicit values for reproducible MML.
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
