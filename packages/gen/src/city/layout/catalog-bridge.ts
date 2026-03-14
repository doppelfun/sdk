/**
 * Map hub/engine catalog entries into SeedBuildingEntry for city layout.
 * Uses API width/depth/height when present; otherwise a single fallback.
 * Models are normalized to center-at-origin.
 */

// --- Types -------------------------------------------------------------------

/** Building entry for city layout; produced from catalog API or params. */
export type SeedBuildingEntry = {
  id: string;
  name: string;
  url: string;
  width?: number;
  depth?: number;
  height?: number;
};

/** Input shape from hub/engine catalog (id required; rest optional). */
export type CatalogLike = {
  id: string;
  name?: string;
  url?: string;
  category?: string;
  assetType?: string;
  /** From catalog API (models). Used for layout when present. */
  width?: number | null;
  depth?: number | null;
  height?: number | null;
};

// --- Constants ---------------------------------------------------------------

/** Default dimensions when catalog has no width/depth/height (metres). */
const FALLBACK = { width: 5, depth: 3, height: 5 } as const;

/** Category substrings that mark an entry as a building (case-insensitive). */
const DEFAULT_BUILDING_CATEGORY_HINTS = ["building", "buildings"];

/** Category name for vehicles (must match hub catalog, e.g. seed-catalog "Vehicles"). */
export const CATEGORY_VEHICLES = "Vehicles";
/** Category name for buildings (must match hub catalog, e.g. seed-catalog "Buildings"). */
export const CATEGORY_BUILDINGS = "Buildings";

// --- Helpers -----------------------------------------------------------------

/** Build a SeedBuildingEntry from id + partial fields; uses FALLBACK for missing dimensions. */
function mergeDims(id: string, partial: Partial<SeedBuildingEntry>): SeedBuildingEntry {
  return {
    id,
    name: partial.name ?? id,
    url: partial.url ?? "",
    width: partial.width != null ? partial.width : FALLBACK.width,
    depth: partial.depth != null ? partial.depth : FALLBACK.depth,
    height: partial.height != null ? partial.height : FALLBACK.height,
  };
}

/** True if entry has valid id and (when required) a non-empty URL. */
function canAddEntry(e: CatalogLike, requireUrl: boolean): boolean {
  const id = (e.id || "").trim();
  if (!id) return false;
  if (requireUrl && !(e.url && String(e.url).trim())) return false;
  return true;
}

/** True if entry looks like a building (category hint) and not a vehicle. */
function isBuildingLike(e: CatalogLike, hints: string[]): boolean {
  const cat = (e.category || "").toLowerCase();
  const assetType = (e.assetType || "").toLowerCase();
  const categoryMatch = hints.some((h) => cat.includes(h) || assetType.includes(h));
  const vehicleLike = cat.includes("vehicle") || cat.includes("car") || assetType.includes("vehicle");
  return categoryMatch && !vehicleLike;
}

// --- Public API --------------------------------------------------------------

/**
 * Turn hub/engine catalog entries into a building pool for generateCityLayout.
 * First pass: include entries matching building category (and not vehicle).
 * If none match, second pass: include any entry with a .glb URL (custom block catalog).
 * Returns [] when no entries pass so caller must pass buildings from API or params.
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
    if (!id || seen.has(id) || (requireUrl && !(e.url && String(e.url).trim()))) return;
    seen.add(id);
    out.push(
      mergeDims(id, {
        name: e.name,
        url: e.url,
        width: e.width ?? undefined,
        depth: e.depth ?? undefined,
        height: e.height ?? undefined,
      })
    );
  };

  for (const e of entries) {
    if (!canAddEntry(e, requireUrl)) continue;
    if (isBuildingLike(e, hints)) pushEntry(e);
  }

  if (out.length === 0) {
    seen.clear();
    for (const e of entries) {
      if (canAddEntry(e, requireUrl) && e.url && /\.glb(\?|$)/i.test(e.url)) pushEntry(e);
    }
  }

  return out;
}

/**
 * Return catalog IDs for entries whose category matches (case-insensitive).
 * Use for Vehicles, Buildings, etc. when generating city by category.
 */
export function getCatalogIdsByCategory(entries: CatalogLike[], category: string): string[] {
  const want = category.trim().toLowerCase();
  if (!want) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const cat = (e.category ?? "").toLowerCase();
    const id = (e.id ?? "").trim();
    if (!id || !cat.includes(want) || seen.has(id)) continue;
    if (e.url && /\.glb(\?|$)/i.test(e.url)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Return catalog IDs for traffic-light-style props (e.g. category Props and id/name contains "traffic").
 * Use when no dedicated StreetFurniture category exists in the hub.
 */
export function getTrafficLightCatalogIds(entries: CatalogLike[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const traffic = "traffic";
  for (const e of entries) {
    const id = (e.id ?? "").trim();
    const name = (e.name ?? "").toLowerCase();
    const cat = (e.category ?? "").toLowerCase();
    if (!id || seen.has(id)) continue;
    if (!(e.url && /\.glb(\?|$)/i.test(e.url))) continue;
    const looksLikeTrafficLight =
      (cat.includes("prop") && (id.toLowerCase().includes(traffic) || name.includes(traffic)));
    if (looksLikeTrafficLight) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Fetch block catalog from hub and return building pool for city layout.
 * Dimensions come from API when present; otherwise FALLBACK (5×3×5 m).
 */
export async function fetchBuildingsFromCatalog(
  hubUrl: string,
  blockId: string,
  apiKey?: string
): Promise<SeedBuildingEntry[]> {
  const { getBlockCatalog } = await import("@doppelfun/sdk");
  const entries = await getBlockCatalog(hubUrl, blockId, apiKey);
  return catalogEntriesToSeedBuildings(entries);
}

/** Result of fetching catalog for city gen: buildings by category Buildings, vehicle and traffic-light IDs by category. */
export type CityCatalogFromHub = {
  buildings: SeedBuildingEntry[];
  vehicleCatalogIds: string[];
  trafficLightCatalogIds: string[];
};

/**
 * Fetch block catalog from hub and return building pool plus vehicle and traffic-light IDs by category.
 * Use for generateCityMml so no catalog IDs are hardcoded (target by category: Vehicles, Buildings).
 */
export async function fetchCityCatalogFromHub(
  hubUrl: string,
  blockId: string,
  apiKey?: string
): Promise<CityCatalogFromHub> {
  const { getBlockCatalog } = await import("@doppelfun/sdk");
  const entries = await getBlockCatalog(hubUrl, blockId, apiKey);
  const buildings = catalogEntriesToSeedBuildings(entries);
  const vehicleCatalogIds = getCatalogIdsByCategory(entries, CATEGORY_VEHICLES);
  const trafficLightCatalogIds = getTrafficLightCatalogIds(entries);
  return { buildings, vehicleCatalogIds, trafficLightCatalogIds };
}

/**
 * Normalize raw params.buildings (e.g. from Claw JSON) into SeedBuildingEntry[].
 * Only id is required per item; name/url/dims are optional and use FALLBACK when missing.
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
      }),
    );
  }
  return out.length > 0 ? out : null;
}
