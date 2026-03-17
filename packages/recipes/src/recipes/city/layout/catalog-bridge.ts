export type SeedBuildingEntry = {
  id: string;
  name: string;
  url: string;
  width?: number;
  depth?: number;
  height?: number;
};

export type CatalogLike = {
  id: string;
  name?: string;
  url?: string;
  category?: string;
  assetType?: string;
  width?: number | null;
  depth?: number | null;
  height?: number | null;
};

const FALLBACK = { width: 5, depth: 3, height: 5 } as const;
const DEFAULT_BUILDING_CATEGORY_HINTS = ["building", "buildings"];

export const CATEGORY_VEHICLES = "Vehicles";

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

function canAddEntry(e: CatalogLike, requireUrl: boolean): boolean {
  const id = (e.id || "").trim();
  if (!id) return false;
  if (requireUrl && !(e.url && String(e.url).trim())) return false;
  return true;
}

function isBuildingLike(e: CatalogLike, hints: string[]): boolean {
  const cat = (e.category || "").toLowerCase();
  const assetType = (e.assetType || "").toLowerCase();
  const categoryMatch = hints.some((h) => cat.includes(h) || assetType.includes(h));
  const vehicleLike = cat.includes("vehicle") || cat.includes("car") || assetType.includes("vehicle");
  return categoryMatch && !vehicleLike;
}

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
    out.push(mergeDims(id, { name: e.name, url: e.url, width: e.width ?? undefined, depth: e.depth ?? undefined, height: e.height ?? undefined }));
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
    if ((cat.includes("prop") && (id.toLowerCase().includes(traffic) || name.includes(traffic)))) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export type CityCatalogFromHub = {
  buildings: SeedBuildingEntry[];
  vehicleCatalogIds: string[];
  trafficLightCatalogIds: string[];
};

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
