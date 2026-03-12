/**
 * Seed building catalog for procedural city generation (SDK-local copy).
 * GLB URLs and dimensions mirror doppel-engine/assets seed-buildings; kept here so
 * @doppelfun/gen does not depend on unpublished @doppel-engine packages.
 * Re-measure with `pnpm run analyze-model-dimensions` (see model-dimensions.ts + README).
 */

/** Base URL for catalog model GLBs — same as engine DEFAULT_LIBRARY_CDN_BASE. */
const DEFAULT_LIBRARY_CDN_BASE = "https://s3.us-west-2.amazonaws.com/cdn.doppel.fun/models";

export type SeedBuildingEntry = {
  id: string;
  name: string;
  url: string;
  width?: number;
  depth?: number;
  height?: number;
  originOffsetX?: number;
  originOffsetZ?: number;
};

export const SEED_BUILDINGS: SeedBuildingEntry[] = [
  { id: "Building", name: "Building", url: `${DEFAULT_LIBRARY_CDN_BASE}/Building.glb` },
  { id: "Building1", name: "Building 1", url: `${DEFAULT_LIBRARY_CDN_BASE}/Building_1.glb` },
  { id: "Building2", name: "Building 2", url: `${DEFAULT_LIBRARY_CDN_BASE}/Building_2.glb` },
  { id: "Building3", name: "Building 3", url: `${DEFAULT_LIBRARY_CDN_BASE}/Building_3.glb` },
  { id: "CompositeBuilding01", name: "Composite Building 01", url: `${DEFAULT_LIBRARY_CDN_BASE}/CompositeBuilding01.glb` },
  { id: "CompositeBuilding02", name: "Composite Building 02", url: `${DEFAULT_LIBRARY_CDN_BASE}/CompositeBuilding02.glb` },
  { id: "CompositeBuilding03", name: "Composite Building 03", url: `${DEFAULT_LIBRARY_CDN_BASE}/CompositeBuilding03.glb` },
  { id: "CompositeBuilding04", name: "Composite Building 04", url: `${DEFAULT_LIBRARY_CDN_BASE}/CompositeBuilding04.glb` },
  { id: "CompositeBuilding05", name: "Composite Building 05", url: `${DEFAULT_LIBRARY_CDN_BASE}/CompositeBuilding05.glb` },
  { id: "CompositeBuilding06", name: "Composite Building 06", url: `${DEFAULT_LIBRARY_CDN_BASE}/CompositeBuilding06.glb` },
];

export const DEFAULT_SEED_BUILDING_DIMENSIONS: Record<
  string,
  { width: number; depth: number; height: number; originOffsetX: number; originOffsetZ: number }
> = {
  Building: { width: 4, depth: 2, height: 13.3, originOffsetX: 2, originOffsetZ: 1 },
  Building1: { width: 4, depth: 2, height: 13.3, originOffsetX: 2, originOffsetZ: 1 },
  Building2: { width: 2, depth: 2, height: 11, originOffsetX: 1, originOffsetZ: 1 },
  Building3: { width: 4, depth: 2, height: 16.2, originOffsetX: 2, originOffsetZ: 1 },
  CompositeBuilding01: { width: 5, depth: 1.391, height: 3.35, originOffsetX: 0, originOffsetZ: 0.02 },
  CompositeBuilding02: { width: 5.161, depth: 4.319, height: 4.07, originOffsetX: 0.03, originOffsetZ: -0.015 },
  CompositeBuilding03: { width: 5.164, depth: 3.85, height: 4.65, originOffsetX: -0.005, originOffsetZ: 0.005 },
  CompositeBuilding04: { width: 4, depth: 2, height: 4.95, originOffsetX: 0, originOffsetZ: 0 },
  CompositeBuilding05: { width: 5.25, depth: 4.26, height: 5.1, originOffsetX: 0.005, originOffsetZ: -0.02 },
  CompositeBuilding06: { width: 5.363, depth: 2.65, height: 4.487, originOffsetX: 0.045, originOffsetZ: 0 },
};

const FALLBACK = { width: 5, depth: 3, height: 5 } as const;

export function getSeedBuildingsWithDimensions(): SeedBuildingEntry[] {
  return SEED_BUILDINGS.map((b) => {
    const dims = DEFAULT_SEED_BUILDING_DIMENSIONS[b.id];
    return {
      ...b,
      width: b.width ?? dims?.width ?? FALLBACK.width,
      depth: b.depth ?? dims?.depth ?? FALLBACK.depth,
      height: b.height ?? dims?.height ?? FALLBACK.height,
      originOffsetX: b.originOffsetX ?? dims?.originOffsetX ?? 0,
      originOffsetZ: b.originOffsetZ ?? dims?.originOffsetZ ?? 0,
    };
  });
}
