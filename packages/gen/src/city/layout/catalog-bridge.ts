/**
 * Map hub/engine catalog entries into SeedBuildingEntry for city layout.
 * Hub lists don't include width/depth/height — we merge DEFAULT_SEED_BUILDING_DIMENSIONS
 * by id when present, else use a generic fallback so layout packing still works.
 */
import { DEFAULT_SEED_BUILDING_DIMENSIONS, type SeedBuildingEntry } from "./seed-buildings.js";

const FALLBACK = { width: 5, depth: 3, height: 5, originOffsetX: 0, originOffsetZ: 0 } as const;

/** Categories treated as building models when filtering hub catalog (case-insensitive substring). */
const DEFAULT_BUILDING_CATEGORY_HINTS = ["building", "buildings"];

export type CatalogLike = {
  id: string;
  name?: string;
  url?: string;
  category?: string;
  assetType?: string;
};

function mergeDims(id: string, partial: Partial<SeedBuildingEntry>): SeedBuildingEntry {
  const dims = DEFAULT_SEED_BUILDING_DIMENSIONS[id];
  return {
    id,
    name: partial.name ?? id,
    url: partial.url ?? "",
    width: partial.width ?? dims?.width ?? FALLBACK.width,
    depth: partial.depth ?? dims?.depth ?? FALLBACK.depth,
    height: partial.height ?? dims?.height ?? FALLBACK.height,
    originOffsetX: partial.originOffsetX ?? dims?.originOffsetX ?? FALLBACK.originOffsetX,
    originOffsetZ: partial.originOffsetZ ?? dims?.originOffsetZ ?? FALLBACK.originOffsetZ,
  };
}

/**
 * Turn hub/engine catalog entries into a building pool for generateCityLayout.
 * Filters to entries that look like buildings (category hint or any model with id).
 * If the filtered list is empty, returns [] so caller can fall back to static SEED_BUILDINGS.
 */
export function catalogEntriesToSeedBuildings(
  entries: CatalogLike[],
  options?: { categoryHints?: string[]; requireUrl?: boolean }
): SeedBuildingEntry[] {
  const hints = (options?.categoryHints ?? DEFAULT_BUILDING_CATEGORY_HINTS).map((h) => h.toLowerCase());
  const requireUrl = options?.requireUrl ?? true;

  const out: SeedBuildingEntry[] = [];
  const seen = new Set<string>();

  const pushEntry = (e: CatalogLike) => {
    const id = (e.id || "").trim();
    if (!id || seen.has(id)) return;
    if (requireUrl && !(e.url && String(e.url).trim())) return;
    seen.add(id);
    out.push(mergeDims(id, { name: e.name, url: e.url }));
  };

  for (const e of entries) {
    const id = (e.id || "").trim();
    if (!id || seen.has(id)) continue;
    if (requireUrl && !(e.url && String(e.url).trim())) continue;

    const cat = (e.category || "").toLowerCase();
    const assetType = (e.assetType || "").toLowerCase();
    const inKnownDims = Boolean(DEFAULT_SEED_BUILDING_DIMENSIONS[id]);
    const categoryMatch = hints.some((h) => cat.includes(h) || assetType.includes(h));
    const vehicleLike = cat.includes("vehicle") || cat.includes("car") || assetType.includes("vehicle");
    if (inKnownDims || (categoryMatch && !vehicleLike)) pushEntry(e);
  }

  // No building-tagged entries — use any GLB so layout still runs with fallback dims (custom block catalog)
  if (out.length === 0) {
    seen.clear();
    for (const e of entries) {
      if (e.url && /\.glb(\?|$)/i.test(e.url)) pushEntry(e);
    }
  }

  return out;
}

/**
 * Normalize raw params.buildings (array of plain objects) into SeedBuildingEntry[].
 * Safe for JSON from Claw — only id required; dims merged from known catalog ids.
 */
export function normalizeBuildingsParam(raw: unknown): SeedBuildingEntry[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: SeedBuildingEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    if (!id) continue;
    out.push(
      mergeDims(id, {
        name: typeof o.name === "string" ? o.name : undefined,
        url: typeof o.url === "string" ? o.url : undefined,
        width: typeof o.width === "number" ? o.width : undefined,
        depth: typeof o.depth === "number" ? o.depth : undefined,
        height: typeof o.height === "number" ? o.height : undefined,
        originOffsetX: typeof o.originOffsetX === "number" ? o.originOffsetX : undefined,
        originOffsetZ: typeof o.originOffsetZ === "number" ? o.originOffsetZ : undefined,
      }),
    );
  }
  return out.length > 0 ? out : null;
}
