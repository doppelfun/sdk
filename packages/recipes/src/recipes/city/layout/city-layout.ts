/**
 * City layout: axis-aligned street grid plus greedy building packing along curbs.
 * 1) Build grid of horizontal/vertical street segments. 2) Treat streets as collision rects. 3) Pack buildings along each side of each street with gap and setback.
 */
import type { SeedBuildingEntry } from "./catalog-bridge.js";
import { mulberry32 } from "../prng.js";

/** One segment of the street grid (axis-aligned line). */
export type StreetSegment = {
  startX: number;
  startZ: number;
  endX: number;
  endZ: number;
  alongX: boolean;
};

/** Placed building: catalog id, center (x,z), rotation, and dimensions. */
export type BuildingPlacement = {
  catalogId: string;
  x: number;
  z: number;
  rotation: number;
  width: number;
  depth: number;
  height: number;
};

export type CityLayoutConfig = {
  centerX?: number;
  centerZ?: number;
  gridRows?: number;
  gridCols?: number;
  blockSize?: number;
  streetWidth?: number;
  buildingSetback?: number;
  seed?: number;
};

export type CityLayoutResult = {
  streets: StreetSegment[];
  buildings: BuildingPlacement[];
  config: Required<CityLayoutConfig>;
};

const DEFAULT_CONFIG: Required<CityLayoutConfig> = {
  centerX: 0,
  centerZ: 0,
  gridRows: 5,
  gridCols: 5,
  blockSize: 30,
  streetWidth: 6,
  buildingSetback: 0.5,
  seed: 12345,
};

/** Gap between adjacent buildings along the curb. */
const SIDE_GAP = 0.2;
/** Padding used for overlap checks (avoid buildings clipping streets or each other). */
const OVERLAP_PAD = 0.1;
/** Skip this distance from street ends (intersections) when packing. */
const INTERSECTION_MARGIN = 1;
const MAX_ATTEMPTS_PER_SLOT = 6;

type Rect = { cx: number; cz: number; w: number; d: number };
type ResolvedBuilding = Required<Pick<SeedBuildingEntry, "id" | "width" | "depth" | "height">>;

function rectsOverlap(a: Rect, b: Rect, pad: number): boolean {
  return (
    a.cx - a.w / 2 - pad < b.cx + b.w / 2 + pad &&
    a.cx + a.w / 2 + pad > b.cx - b.w / 2 - pad &&
    a.cz - a.d / 2 - pad < b.cz + b.d / 2 + pad &&
    a.cz + a.d / 2 + pad > b.cz - b.d / 2 - pad
  );
}

/** True if candidate overlaps any street rect or existing placement. */
function collides(candidate: Rect, streetRects: Rect[], placements: BuildingPlacement[]): boolean {
  for (const r of streetRects) {
    if (rectsOverlap(candidate, r, OVERLAP_PAD)) return true;
  }
  for (const p of placements) {
    if (rectsOverlap(candidate, { cx: p.x, cz: p.z, w: p.width, d: p.depth }, OVERLAP_PAD)) {
      return true;
    }
  }
  return false;
}

/** Build horizontal and vertical street segments from grid (rows × cols, blockSize spacing). */
function buildStreetGrid(cfg: Required<CityLayoutConfig>): StreetSegment[] {
  const streets: StreetSegment[] = [];
  const totalW = (cfg.gridCols - 1) * cfg.blockSize;
  const totalD = (cfg.gridRows - 1) * cfg.blockSize;
  const ox = cfg.centerX - totalW / 2;
  const oz = cfg.centerZ - totalD / 2;

  for (let row = 0; row < cfg.gridRows; row++) {
    const z = oz + row * cfg.blockSize;
    streets.push({ startX: ox, startZ: z, endX: ox + totalW, endZ: z, alongX: true });
  }
  for (let col = 0; col < cfg.gridCols; col++) {
    const x = ox + col * cfg.blockSize;
    streets.push({ startX: x, startZ: oz, endX: x, endZ: oz + totalD, alongX: false });
  }
  return streets;
}

/** Convert street segments to axis-aligned rects for collision (streetWidth thick). */
function buildStreetRects(streets: StreetSegment[], streetWidth: number): Rect[] {
  return streets.map((s) =>
    s.alongX
      ? { cx: (s.startX + s.endX) / 2, cz: s.startZ, w: s.endX - s.startX, d: streetWidth }
      : { cx: s.startX, cz: (s.startZ + s.endZ) / 2, w: streetWidth, d: s.endZ - s.startZ },
  );
}

/** Rotation (radians) so building faces the street; sideSign is +1 or -1 for which side of the segment. */
function facingAngle(alongX: boolean, sideSign: number): number {
  const base = alongX
    ? sideSign > 0
      ? Math.PI / 2
      : -Math.PI / 2
    : sideSign > 0
      ? Math.PI
      : 0;
  return base - Math.PI / 2;
}

/** Greedily pack buildings along one side of a street (curbOffset from center; sideSign ±1). */
function packOneSide(
  street: StreetSegment,
  pool: ResolvedBuilding[],
  placements: BuildingPlacement[],
  random: () => number,
  curbOffset: number,
  sideSign: number,
  streetRects: Rect[],
  sortedPool: ResolvedBuilding[],
  narrowest: number,
): void {
  const length = street.alongX ? street.endX - street.startX : street.endZ - street.startZ;
  if (length < INTERSECTION_MARGIN * 2 + narrowest) return;

  const dirX = street.alongX ? 1 : 0;
  const dirZ = street.alongX ? 0 : 1;
  const perpX = street.alongX ? 0 : 1;
  const perpZ = street.alongX ? -1 : 0;
  const rot = facingAngle(street.alongX, sideSign);

  const tEnd = length - INTERSECTION_MARGIN;
  let t = INTERSECTION_MARGIN;

  while (t < tEnd) {
    if (tEnd - t < narrowest) break;

    let placed = false;
    const maxAttempts = Math.min(pool.length, MAX_ATTEMPTS_PER_SLOT);

    for (let attempt = 0; attempt < maxAttempts && !placed; attempt++) {
      const building =
        attempt === 0
          ? pool[Math.floor(random() * pool.length)]!
          : sortedPool[Math.floor(random() * Math.min(sortedPool.length, attempt + 2))]!;

      if (t + building.width > tEnd) continue;

      const perpDist = (curbOffset + building.depth / 2) * sideSign;
      const cx = street.startX + dirX * (t + building.width / 2) + perpX * perpDist;
      const cz = street.startZ + dirZ * (t + building.width / 2) + perpZ * perpDist;

      const candidate: Rect = { cx, cz, w: building.width, d: building.depth };
      if (collides(candidate, streetRects, placements)) continue;

      placements.push({
        catalogId: building.id,
        x: cx,
        z: cz,
        rotation: rot,
        width: building.width,
        depth: building.depth,
        height: building.height,
      });
      t += building.width + SIDE_GAP;
      placed = true;
    }

    if (!placed) t += narrowest + SIDE_GAP;
  }
}

/** Generate street grid and building placements from seed buildings and config. */
export function generateCityLayout(
  buildings: SeedBuildingEntry[],
  config: CityLayoutConfig = {},
): CityLayoutResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const random = mulberry32(cfg.seed);

  const streets = buildStreetGrid(cfg);
  const streetRects = buildStreetRects(streets, cfg.streetWidth);
  const placements: BuildingPlacement[] = [];

  const pool: ResolvedBuilding[] = buildings.map((b) => ({
    id: b.id,
    width: b.width ?? 1,
    depth: b.depth ?? 1,
    height: b.height ?? 1,
  }));

  if (pool.length === 0) {
    return { streets, buildings: placements, config: cfg };
  }

  const sortedPool = [...pool].sort((a, b) => a.width - b.width);
  const narrowest = sortedPool[0]!.width;
  const curbOffset = cfg.streetWidth / 2 + cfg.buildingSetback;

  for (const street of streets) {
    packOneSide(street, pool, placements, random, curbOffset, +1, streetRects, sortedPool, narrowest);
    packOneSide(street, pool, placements, random, curbOffset, -1, streetRects, sortedPool, narrowest);
  }

  return { streets, buildings: placements, config: cfg };
}
