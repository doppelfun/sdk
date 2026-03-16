export type GrassGenConfig = {
  patches: number;
  count: number;
  spreadMin: number;
  spreadMax: number;
  height: number;
  y: number;
  seed: number;
  margin: number;
  emissionIntensity: number;
};

export const DEFAULT_GRASS_CONFIG: GrassGenConfig = {
  patches: 3,
  count: 800,
  spreadMin: 2,
  spreadMax: 5,
  height: 0.5,
  y: 0.5,
  seed: 42,
  margin: 2,
  emissionIntensity: 0.18,
};

export function clampGrassConfig(c: Partial<GrassGenConfig>): GrassGenConfig {
  const n = (v: number | undefined, d: number, min: number, max: number) => {
    if (v == null || Number.isNaN(v)) return d;
    return Math.max(min, Math.min(max, v));
  };
  const margin = n(c.margin, DEFAULT_GRASS_CONFIG.margin, 0, 20);
  const spreadMax = n(c.spreadMax, DEFAULT_GRASS_CONFIG.spreadMax, 0.5, 30);
  const spreadMin = Math.min(n(c.spreadMin, DEFAULT_GRASS_CONFIG.spreadMin, 0.5, 30), spreadMax);
  return {
    patches: n(c.patches, DEFAULT_GRASS_CONFIG.patches, 0, 50),
    count: n(c.count, DEFAULT_GRASS_CONFIG.count, 50, 10000),
    spreadMin,
    spreadMax,
    height: n(c.height, DEFAULT_GRASS_CONFIG.height, 0.1, 3),
    y: n(c.y, DEFAULT_GRASS_CONFIG.y, 0, 10),
    seed: n(c.seed, DEFAULT_GRASS_CONFIG.seed, 0, 2 ** 31 - 1),
    margin,
    emissionIntensity: n(c.emissionIntensity, DEFAULT_GRASS_CONFIG.emissionIntensity, 0, 2),
  };
}
