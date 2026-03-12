/**
 * Procedural city grid → MML using @doppel-engine/assets layout + optional pyramid cell.
 */
import { BLOCK_SIZE_M } from "@doppel-engine/schema";
import { generateCityLayout, getSeedBuildingsWithDimensions } from "@doppel-engine/assets";
import type { BuildingPlacement, StreetSegment } from "@doppel-engine/assets";
import { mulberry32, r2, deg } from "../shared/prng.js";
import type { CityGenConfig } from "./config.js";
import { clampCityConfig } from "./config.js";

const ANTENNA_HEIGHT_THRESHOLD = 8;
const ANTENNA_CHANCE = 0.4;
const ANTENNA_COLORS = [
  "#ff0040", "#00ff88", "#00aaff", "#ff6600",
  "#cc00ff", "#ffdd00", "#ff0088", "#00ffcc",
];
const WINDOW_COLORS = ["#ff0040", "#00ff88", "#00aaff", "#ff6600", "#cc00ff"];
const WINS_PER_FACE_MIN = 2;
const WINS_PER_FACE_MAX = 4;
const WIN_W = 0.35;
const WIN_H = 0.45;
const WIN_INTENSITY = 3.0;

const STONE_VARIANTS = ["#8a8578", "#6e6960", "#9e978a"];
const GLOW_COLOR = "#00ff66";
const DOOR_HEIGHT_LAYERS = 3;
const PYRAMID_BLOCK_SIZE = 1;
const PYRAMID_LAYERS = 20;
const PYRAMID_DOOR_WIDTH_BLKS = 3;
const PYRAMID_SEED = 77;

type PyramidBlock = {
  x: number; y: number; z: number; size: number;
  color: string; emission?: string;
  layer: number; isCorner: boolean;
};

type PyramidGrassPatch = { dx: number; dz: number; count: number; spread: number; h: number };

type CellBounds = { minX: number; maxX: number; minZ: number; maxZ: number };

function getCellBounds(cfg: {
  gridRows: number; gridCols: number; blockSize: number; streetWidth: number; centerX: number; centerZ: number;
}): (row: number, col: number) => CellBounds | null {
  const totalW = (cfg.gridCols - 1) * cfg.blockSize;
  const totalD = (cfg.gridRows - 1) * cfg.blockSize;
  const ox = cfg.centerX - totalW / 2;
  const oz = cfg.centerZ - totalD / 2;
  const hw = cfg.streetWidth / 2;
  return (row: number, col: number) => {
    if (row < 0 || row >= cfg.gridRows - 1 || col < 0 || col >= cfg.gridCols - 1) return null;
    return {
      minX: ox + col * cfg.blockSize + hw,
      maxX: ox + (col + 1) * cfg.blockSize - hw,
      minZ: oz + row * cfg.blockSize + hw,
      maxZ: oz + (row + 1) * cfg.blockSize - hw,
    };
  };
}

function buildingInCell(b: BuildingPlacement, cell: CellBounds): boolean {
  return b.x >= cell.minX && b.x <= cell.maxX && b.z >= cell.minZ && b.z <= cell.maxZ;
}

function generatePyramidForCell(cell: CellBounds): { blocks: PyramidBlock[]; totalLayers: number; baseWidth: number } {
  const rng = mulberry32(PYRAMID_SEED);
  const blocks: PyramidBlock[] = [];
  const cellSize = Math.min(cell.maxX - cell.minX, cell.maxZ - cell.minZ);
  const baseWidth = cellSize * 0.85;
  const baseBlocks = Math.floor(baseWidth / PYRAMID_BLOCK_SIZE);
  const totalLayers = Math.min(PYRAMID_LAYERS, Math.floor(baseBlocks / 2));

  for (let layer = 0; layer < totalLayers; layer++) {
    const span = baseBlocks - layer * 2;
    if (span < 1) break;
    const half = (span * PYRAMID_BLOCK_SIZE) / 2;
    const y = layer * PYRAMID_BLOCK_SIZE + PYRAMID_BLOCK_SIZE / 2;
    const doorCentre = Math.floor(span / 2);
    const doorHalf = Math.floor(PYRAMID_DOOR_WIDTH_BLKS / 2);

    for (let bx = 0; bx < span; bx++) {
      for (let bz = 0; bz < span; bz++) {
        const onEdge = bx === 0 || bx === span - 1 || bz === 0 || bz === span - 1;
        if (!onEdge) continue;
        if (layer < DOOR_HEIGHT_LAYERS && bz === 0 &&
            bx >= doorCentre - doorHalf && bx <= doorCentre + doorHalf) continue;

        const x = -half + bx * PYRAMID_BLOCK_SIZE + PYRAMID_BLOCK_SIZE / 2;
        const z = -half + bz * PYRAMID_BLOCK_SIZE + PYRAMID_BLOCK_SIZE / 2;
        const isCorner = (bx === 0 || bx === span - 1) && (bz === 0 || bz === span - 1);
        if (isCorner) {
          blocks.push({ x, y, z, size: PYRAMID_BLOCK_SIZE, color: GLOW_COLOR, emission: GLOW_COLOR, layer, isCorner: true });
        } else {
          const color = STONE_VARIANTS[Math.floor(rng() * STONE_VARIANTS.length)]!;
          blocks.push({ x, y, z, size: PYRAMID_BLOCK_SIZE, color, layer, isCorner: false });
        }
      }
    }
  }
  return { blocks, totalLayers, baseWidth };
}

const PULSE_CYCLE_MS = 2000;
const PULSE_DIM = 0.3;
const PULSE_BRIGHT = 3;
const PYRAMID_GRASS_Y = 0.6;
const PYRAMID_GRASS_EMISSION_INTENSITY = 0.06;
const PYRAMID_GRASS_COLOR = GLOW_COLOR;
const PYRAMID_GRASS_COLOR_DARK = "#008833";

const PYRAMID_GRASS_PATCHES: readonly PyramidGrassPatch[] = [
  { dx: -3, dz: -3, count: 80, spread: 0.8, h: 0.25 },
  { dx: 3, dz: -3, count: 70, spread: 0.7, h: 0.2 },
  { dx: -3, dz: 3, count: 75, spread: 0.7, h: 0.3 },
  { dx: 3, dz: 3, count: 65, spread: 0.6, h: 0.2 },
  { dx: 0, dz: 0, count: 90, spread: 0.9, h: 0.35 },
  { dx: -1, dz: 2, count: 60, spread: 0.5, h: 0.2 },
  { dx: 2, dz: -1, count: 55, spread: 0.5, h: 0.25 },
];

function emitPyramidBlock(parts: string[], idx: number, block: PyramidBlock, cx: number, cz: number, layerDelay: number): void {
  const s = r2(block.size);
  const bx = r2(block.x + cx);
  const by = r2(block.y);
  const bz = r2(block.z + cz);
  let attrs = `id="pyr-${idx}" x="${bx}" y="${by}" z="${bz}"`;
  attrs += ` width="${s}" height="${s}" depth="${s}" color="${block.color}" collide="true"`;
  if (!block.isCorner || !block.emission) {
    parts.push(`  <m-cube ${attrs} />`);
    return;
  }
  attrs += ` emission="${block.emission}" emission-intensity="${PULSE_DIM}"`;
  const startTime = Math.round(block.layer * layerDelay);
  parts.push(`  <m-cube ${attrs}>`);
  parts.push(`    <m-attr-anim attr="emission-intensity" start="${PULSE_DIM}" end="${PULSE_BRIGHT}" duration="${PULSE_CYCLE_MS}" start-time="${startTime}" loop="true" ping-pong="true" easing="easeInOutSine" />`);
  parts.push(`  </m-cube>`);
}

function emitPyramidGrass(parts: string[], cx: number, cz: number, baseWidth: number): void {
  const maxSpread = baseWidth * 0.25;
  for (let i = 0; i < PYRAMID_GRASS_PATCHES.length; i++) {
    const patch = PYRAMID_GRASS_PATCHES[i]!;
    const spread = Math.min(patch.spread, maxSpread);
    parts.push(
      `  <m-grass id="pyr-grass-${i}" x="${r2(cx + patch.dx)}" y="${r2(PYRAMID_GRASS_Y)}" z="${r2(cz + patch.dz)}"` +
      ` count="${patch.count}" spread-x="${r2(spread)}" spread-z="${r2(spread)}" height="${patch.h}"` +
      ` color="${PYRAMID_GRASS_COLOR}" color-dark="${PYRAMID_GRASS_COLOR_DARK}" emission="${PYRAMID_GRASS_COLOR}" emission-intensity="${PYRAMID_GRASS_EMISSION_INTENSITY}" />`,
    );
  }
}

function emitPyramidParticles(parts: string[], cx: number, cz: number, baseWidth: number): void {
  const maxSpread = baseWidth * 0.25;
  for (let i = 0; i < PYRAMID_GRASS_PATCHES.length; i++) {
    const patch = PYRAMID_GRASS_PATCHES[i]!;
    const spread = Math.min(patch.spread, maxSpread);
    const particleCount = Math.min(512, Math.max(96, Math.floor(patch.count * 1.2)));
    parts.push(
      `  <m-particle id="pyr-particle-${i}" x="${r2(cx + patch.dx)}" y="${r2(PYRAMID_GRASS_Y)}" z="${r2(cz + patch.dz)}"` +
      ` count="${particleCount}" spread-x="${r2(spread)}" spread-z="${r2(spread)}" spread-y="${r2(patch.h * 0.15)}"` +
      ` spawn-radius="0.45" color="${PYRAMID_GRASS_COLOR}" />`,
    );
  }
}

function emitPyramid(parts: string[], cell: CellBounds, offsetX: number, offsetZ: number): void {
  const cx = (cell.minX + cell.maxX) / 2 + offsetX;
  const cz = (cell.minZ + cell.maxZ) / 2 + offsetZ;
  const { blocks, totalLayers, baseWidth } = generatePyramidForCell(cell);
  const layerDelay = PULSE_CYCLE_MS / Math.max(1, totalLayers);
  for (let i = 0; i < blocks.length; i++) emitPyramidBlock(parts, i, blocks[i]!, cx, cz, layerDelay);
  emitPyramidGrass(parts, cx, cz, baseWidth);
  emitPyramidParticles(parts, cx, cz, baseWidth);
}

function emitAntenna(parts: string[], idx: number, b: BuildingPlacement, bx: number, bz: number, rng: () => number): void {
  const poleH = 0.8 + rng() * 1.2;
  const poleW = 0.08 + rng() * 0.06;
  const tipSize = 0.15 + rng() * 0.15;
  const color = ANTENNA_COLORS[Math.floor(rng() * ANTENNA_COLORS.length)]!;
  const intensity = 3 + rng() * 7;
  const jx = (rng() - 0.5) * b.width * 0.4;
  const jz = (rng() - 0.5) * b.depth * 0.4;
  const poleY = b.height + poleH / 2;
  const tipY = b.height + poleH + tipSize / 2;
  parts.push(
    `  <m-cube id="ant-pole-${idx}" x="${r2(bx + jx)}" y="${r2(poleY)}" z="${r2(bz + jz)}" width="${r2(poleW)}" height="${r2(poleH)}" depth="${r2(poleW)}" color="#666666" />`,
    `  <m-cube id="ant-tip-${idx}" x="${r2(bx + jx)}" y="${r2(tipY)}" z="${r2(bz + jz)}" width="${r2(tipSize)}" height="${r2(tipSize)}" depth="${r2(tipSize)}" color="${color}" emission="${color}" emission-intensity="${r2(intensity)}" />`,
  );
}

function emitWindows(parts: string[], idx: number, b: BuildingPlacement, bx: number, bz: number, rng: () => number): void {
  const θ = b.rotation;
  const cosR = Math.cos(θ);
  const sinR = Math.sin(θ);
  const ox = b.originOffsetX;
  const oz = b.originOffsetZ;
  const geoCX = bx + ox * cosR + oz * sinR;
  const geoCZ = bz - ox * sinR + oz * cosR;
  const wColor = WINDOW_COLORS[Math.floor(rng() * WINDOW_COLORS.length)]!;
  let winIdx = 0;
  const hw = b.width / 2;
  const hd = b.depth / 2;
  const faces = [
    { nx: 0, nz: 1, dist: hd, span: b.width, winRy: θ },
    { nx: 0, nz: -1, dist: hd, span: b.width, winRy: θ + Math.PI },
    { nx: -1, nz: 0, dist: hw, span: b.depth, winRy: θ - Math.PI / 2 },
    { nx: 1, nz: 0, dist: hw, span: b.depth, winRy: θ + Math.PI / 2 },
  ];
  for (const face of faces) {
    const perFace = WINS_PER_FACE_MIN + Math.floor(rng() * (WINS_PER_FACE_MAX - WINS_PER_FACE_MIN + 1));
    const placed: { lat: number; y: number }[] = [];
    const PAD = 0.05;
    let attempts = 0;
    for (let w = 0; w < perFace && attempts < perFace * 4; ) {
      const wy = b.height * (0.1 + rng() * 0.8);
      const lateral = (rng() - 0.5) * 0.7 * face.span;
      attempts++;
      const overlaps = placed.some((p) => Math.abs(p.lat - lateral) < WIN_W + PAD && Math.abs(p.y - wy) < WIN_H + PAD);
      if (overlaps) continue;
      placed.push({ lat: lateral, y: wy });
      const localX = face.nx * (face.dist + 0.02) + (face.nz !== 0 ? lateral : 0);
      const localZ = face.nz * (face.dist + 0.02) + (face.nx !== 0 ? lateral : 0);
      const wx = geoCX + localX * cosR + localZ * sinR;
      const wz = geoCZ - localX * sinR + localZ * cosR;
      parts.push(
        `  <m-cube id="win-${idx}-${winIdx}" x="${r2(wx)}" y="${r2(wy)}" z="${r2(wz)}" ry="${deg(face.winRy)}" width="${WIN_W}" height="${WIN_H}" depth="0.05" color="${wColor}" emission="${wColor}" emission-intensity="${WIN_INTENSITY}" />`,
      );
      winIdx++;
      w++;
    }
  }
}

function cityToMml(
  buildings: BuildingPlacement[],
  streets: StreetSegment[],
  streetWidth: number,
  offsetX: number,
  offsetZ: number,
  seed: number,
  pyramidCell: CellBounds | null,
): string {
  const parts: string[] = [];
  const rng = mulberry32(seed ^ 0xbeef);
  const roadY = 0.5;
  const roadThickness = 0.1;

  for (let i = 0; i < streets.length; i++) {
    const s = streets[i]!;
    const cx = (s.startX + s.endX) / 2 + offsetX;
    const cz = (s.startZ + s.endZ) / 2 + offsetZ;
    const len = s.alongX ? s.endX - s.startX : s.endZ - s.startZ;
    const w = s.alongX ? len : streetWidth;
    const d = s.alongX ? streetWidth : len;
    parts.push(
      `  <m-cube id="street-${i}" x="${r2(cx)}" y="${r2(roadY)}" z="${r2(cz)}" width="${r2(w)}" height="${r2(roadThickness)}" depth="${r2(d)}" color="#333333" />`,
    );
  }

  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i]!;
    if (pyramidCell && buildingInCell(b, pyramidCell)) continue;
    const bx = b.x + offsetX;
    const bz = b.z + offsetZ;
    parts.push(
      `  <m-model id="bldg-${i}" x="${r2(bx)}" y="0" z="${r2(bz)}" ry="${deg(b.rotation)}" catalogId="${b.catalogId}" collide="true" />`,
    );
    const hasAntenna = b.height >= ANTENNA_HEIGHT_THRESHOLD && rng() < ANTENNA_CHANCE;
    if (hasAntenna) emitAntenna(parts, i, b, bx, bz, rng);
    if (!hasAntenna && b.catalogId === "Building2") emitWindows(parts, i, b, bx, bz, rng);
  }

  if (pyramidCell) emitPyramid(parts, pyramidCell, offsetX, offsetZ);
  return `<m-group id="city-layout-root">\n${parts.join("\n")}\n</m-group>`;
}

/** Pure MML generator — no I/O. Uses seed buildings from assets (catalogIds from layout). */
export function generateCityMml(config: Partial<CityGenConfig> = {}): string {
  const c = clampCityConfig(config);
  const layoutCfg = {
    centerX: 0,
    centerZ: 0,
    gridRows: c.gridRows,
    gridCols: c.gridCols,
    blockSize: c.blockSize,
    streetWidth: c.streetWidth,
    buildingSetback: c.buildingSetback,
    seed: c.seed,
  };
  const layout = generateCityLayout(getSeedBuildingsWithDimensions(), layoutCfg);

  let pyramidCell: CellBounds | null = null;
  if (c.pyramidRow != null && c.pyramidCol != null) {
    const cellFn = getCellBounds({ ...layoutCfg, centerX: 0, centerZ: 0 });
    pyramidCell = cellFn(c.pyramidRow, c.pyramidCol);
  }

  const offsetX = BLOCK_SIZE_M / 2;
  const offsetZ = BLOCK_SIZE_M / 2;
  return cityToMml(layout.buildings, layout.streets, c.streetWidth, offsetX, offsetZ, c.seed, pyramidCell);
}
