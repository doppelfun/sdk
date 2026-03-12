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

export function clampPyramidConfig(c: Partial<PyramidGenConfig>): PyramidGenConfig {
  const n = (v: number | undefined, d: number, min: number, max: number) => {
    if (v == null || Number.isNaN(v)) return d;
    return Math.max(min, Math.min(max, v));
  };
  return {
    baseWidth: n(c.baseWidth, DEFAULT_PYRAMID_CONFIG.baseWidth, 4, 60),
    layers: n(c.layers, DEFAULT_PYRAMID_CONFIG.layers, 2, 30),
    blockSize: n(c.blockSize, DEFAULT_PYRAMID_CONFIG.blockSize, 0.5, 10),
    doorWidthBlocks: n(c.doorWidthBlocks, DEFAULT_PYRAMID_CONFIG.doorWidthBlocks, 1, 10),
    seed: n(c.seed, DEFAULT_PYRAMID_CONFIG.seed, 0, 2 ** 31 - 1),
    cx: n(c.cx, DEFAULT_PYRAMID_CONFIG.cx, 0, 100),
    cz: n(c.cz, DEFAULT_PYRAMID_CONFIG.cz, 0, 100),
  };
}
