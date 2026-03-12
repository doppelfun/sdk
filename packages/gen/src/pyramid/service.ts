/**
 * Hollow stepped pyramid → MML (m-cube perimeter, doorway, glowing corners).
 */
import { mulberry32, r2 } from "../shared/prng.js";
import type { PyramidGenConfig } from "./config.js";
import { clampPyramidConfig } from "./config.js";

const STONE_VARIANTS = ["#8a8578", "#6e6960", "#9e978a"];
const GLOW_COLORS = [
  "#00ff66", "#33ff88", "#00cc44", "#66ffaa",
  "#00ff99", "#22ee55", "#44ff77", "#00dd55",
];
const DOOR_HEIGHT_LAYERS = 3;

type PyramidBlock = {
  x: number;
  y: number;
  z: number;
  size: number;
  color: string;
  emission?: string;
  emissionIntensity?: number;
};

function generatePyramidBlocks(
  baseWidth: number,
  layers: number,
  blockSize: number,
  doorWidthBlocks: number,
  seed: number,
): PyramidBlock[] {
  const rng = mulberry32(seed);
  const blocks: PyramidBlock[] = [];
  const baseBlocks = Math.floor(baseWidth / blockSize);

  for (let layer = 0; layer < layers; layer++) {
    const span = baseBlocks - layer * 2;
    if (span < 1) break;

    const half = (span * blockSize) / 2;
    const y = layer * blockSize + blockSize / 2;
    const doorCentre = Math.floor(span / 2);
    const doorHalf = Math.floor(doorWidthBlocks / 2);

    for (let bx = 0; bx < span; bx++) {
      for (let bz = 0; bz < span; bz++) {
        const onEdge =
          bx === 0 || bx === span - 1 || bz === 0 || bz === span - 1;
        if (!onEdge) continue;

        if (
          layer < DOOR_HEIGHT_LAYERS && bz === 0 &&
          bx >= doorCentre - doorHalf && bx <= doorCentre + doorHalf
        ) continue;

        const x = -half + bx * blockSize + blockSize / 2;
        const z = -half + bz * blockSize + blockSize / 2;
        const isCorner =
          (bx === 0 || bx === span - 1) && (bz === 0 || bz === span - 1);

        if (isCorner) {
          const color = GLOW_COLORS[Math.floor(rng() * GLOW_COLORS.length)]!;
          blocks.push({
            x, y, z, size: blockSize,
            color, emission: color,
            emissionIntensity: 3 + rng() * 4,
          });
        } else {
          const color = STONE_VARIANTS[Math.floor(rng() * STONE_VARIANTS.length)]!;
          blocks.push({ x, y, z, size: blockSize, color });
        }
      }
    }
  }

  return blocks;
}

function blocksToMml(blocks: PyramidBlock[], cx: number, cz: number): string {
  const cubes = blocks.map((b, i) => {
    const s = r2(b.size);
    let attrs = `id="pyr-${i}" x="${r2(b.x + cx)}" y="${r2(b.y)}" z="${r2(b.z + cz)}"`;
    attrs += ` width="${s}" height="${s}" depth="${s}" color="${b.color}" collide="true"`;
    if (b.emission) {
      attrs += ` emission="${b.emission}" emission-intensity="${r2(b.emissionIntensity!)}"`;
    }
    return `  <m-cube ${attrs} />`;
  });
  return `<m-group id="pyramid-root">\n${cubes.join("\n")}\n</m-group>`;
}

/** Pure MML generator — no I/O. */
export function generatePyramidMml(config: Partial<PyramidGenConfig> = {}): string {
  const c = clampPyramidConfig(config);
  const blocks = generatePyramidBlocks(
    c.baseWidth, c.layers, c.blockSize, c.doorWidthBlocks, c.seed,
  );
  return blocksToMml(blocks, c.cx, c.cz);
}

export function pyramidBlockCount(config: Partial<PyramidGenConfig> = {}): number {
  const c = clampPyramidConfig(config);
  return generatePyramidBlocks(
    c.baseWidth, c.layers, c.blockSize, c.doorWidthBlocks, c.seed,
  ).length;
}
