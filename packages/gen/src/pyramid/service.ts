/**
 * Hollow stepped pyramid → MML (m-cube perimeter, doorway, glowing corners).
 */
import { mulberry32, r2 } from "../shared/prng.js";
import type { PyramidGenConfig } from "./config.js";
import { clampPyramidConfig } from "./config.js";

const STONE_VARIANTS = ["#8a8578", "#6e6960", "#9e978a"];
/** Corner emissive palette — mixed hues so pyramids aren’t “all green”. */
const GLOW_COLORS = [
  "#ff0040", "#00ff88", "#00aaff", "#ff6600",
  "#cc00ff", "#ffdd00", "#ff0088", "#00ffcc",
  "#00ff66", "#ff3366", "#66aaff", "#ffaa00",
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

/**
 * Stable corner index 0..3 from perimeter grid position (door faces bz===0).
 * 0 = (0,0), 1 = (max,0), 2 = (0,max), 3 = (max,max) in (bx,bz).
 */
function cornerPaletteIndex(bx: number, bz: number, span: number): number {
  const left = bx === 0 ? 0 : 1;
  const front = bz === 0 ? 0 : 2;
  return left + front;
}

function pickCornerColor(
  bx: number,
  bz: number,
  span: number,
  layer: number,
  cornerColors: string[] | undefined,
  singleRandomColor: string | undefined,
): string {
  if (cornerColors && cornerColors.length > 0) {
    const idx = cornerPaletteIndex(bx, bz, span);
    const i = (idx + layer * 4) % cornerColors.length;
    return cornerColors[i]!;
  }
  // No palette: one random color for the whole pyramid (caller passes same string every time).
  return singleRandomColor ?? GLOW_COLORS[0]!;
}

function generatePyramidBlocks(
  baseWidth: number,
  layers: number,
  blockSize: number,
  doorWidthBlocks: number,
  seed: number,
  cornerColors?: string[],
  cornerEmissionIntensity?: number,
): PyramidBlock[] {
  const rng = mulberry32(seed);
  const blocks: PyramidBlock[] = [];
  // One random emissive color for entire pyramid when not using cornerColors.
  const singleGlowColor =
    !cornerColors?.length
      ? GLOW_COLORS[Math.floor(rng() * GLOW_COLORS.length)]!
      : undefined;
  const singleGlowIntensity =
    cornerEmissionIntensity == null && singleGlowColor != null
      ? 3 + rng() * 4
      : undefined;
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
          const color = pickCornerColor(
            bx, bz, span, layer, cornerColors, singleGlowColor,
          );
          const emissionIntensity =
            cornerEmissionIntensity != null
              ? cornerEmissionIntensity
              : singleGlowIntensity ?? 3 + rng() * 4;
          blocks.push({
            x, y, z, size: blockSize,
            color, emission: color,
            emissionIntensity,
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
    c.baseWidth,
    c.layers,
    c.blockSize,
    c.doorWidthBlocks,
    c.seed,
    c.cornerColors,
    c.cornerEmissionIntensity,
  );
  return blocksToMml(blocks, c.cx, c.cz);
}

export function pyramidBlockCount(config: Partial<PyramidGenConfig> = {}): number {
  const c = clampPyramidConfig(config);
  return generatePyramidBlocks(
    c.baseWidth,
    c.layers,
    c.blockSize,
    c.doorWidthBlocks,
    c.seed,
    c.cornerColors,
    c.cornerEmissionIntensity,
  ).length;
}
