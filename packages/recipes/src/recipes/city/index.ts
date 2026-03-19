/**
 * City recipe: street grid, buildings, optional pyramid cell, lights, vehicles.
 * Exports recipeManifest (from recipe.json) and run for the loader.
 * run() accepts params.catalog (full catalog); the recipe parses it to buildings, vehicleCatalogIds, trafficLightCatalogIds.
 * Also supports explicit params.buildings / vehicleCatalogIds / trafficLightCatalogIds for backward compatibility.
 */
import manifestJson from "./recipe.json" with { type: "json" };
import type { RecipeManifest, RecipeRunner } from "../../types.js";
import { generateCityMml } from "./service.js";
import { clampCityConfig } from "./config.js";
import {
  normalizeBuildingsParam,
  catalogEntriesToSeedBuildings,
  getCatalogIdsByCategory,
  getTrafficLightCatalogIds,
  CATEGORY_VEHICLES,
  type CatalogLike,
} from "./layout/index.js";

const manifest = manifestJson as RecipeManifest;
export const recipeManifest = manifest;

/** Extract params from raw; top-level params object or empty. */
function getParams(raw: Record<string, unknown>): Record<string, unknown> {
  const p = raw.params;
  if (p && typeof p === "object" && !Array.isArray(p)) return p as Record<string, unknown>;
  return {};
}

/** Coerce a single raw catalog item to CatalogLike; returns null if id missing. */
function rawItemToCatalogLike(item: unknown): CatalogLike | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  if (!id) return null;
  const numOrNull = (v: unknown): number | null | undefined =>
    typeof v === "number" ? v : (v as null) === null ? null : undefined;
  return {
    id,
    name: typeof o.name === "string" ? o.name : undefined,
    url: typeof o.url === "string" ? o.url : undefined,
    category: typeof o.category === "string" ? o.category : undefined,
    assetType: typeof (o as { assetType?: unknown }).assetType === "string" ? (o as { assetType: string }).assetType : undefined,
    width: numOrNull(o.width),
    depth: numOrNull(o.depth),
    height: numOrNull(o.height),
  };
}

/** Normalize catalog param to CatalogLike[] or null. */
function normalizeCatalogParam(raw: unknown): CatalogLike[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: CatalogLike[] = [];
  for (const item of raw) {
    const entry = rawItemToCatalogLike(item);
    if (entry) out.push(entry);
  }
  return out.length > 0 ? out : null;
}

/** Read one numeric param with optional fallback key (e.g. rows vs gridRows). */
function numParam(c: Record<string, unknown>, primary: string, fallback?: string): number | undefined {
  const v = c[primary];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (fallback != null) {
    const w = c[fallback];
    if (typeof w === "number" && Number.isFinite(w)) return w;
  }
  return undefined;
}

/** Read string array from params with two possible keys (e.g. vehicleCatalogIds / vehicle_catalog_ids). */
function stringArrayParam(
  c: Record<string, unknown>,
  key1: string,
  key2: string
): string[] | undefined {
  const arr = (c[key1] ?? c[key2]) as unknown;
  if (!Array.isArray(arr) || !arr.every((id): id is string => typeof id === "string")) return undefined;
  return arr.length > 0 ? arr : undefined;
}

export const run: RecipeRunner = (raw: Record<string, unknown>): string => {
  const c = getParams(raw);
  const rawCatalog = c.catalog ?? (raw as { catalog?: unknown }).catalog;
  const rawBuildings = c.buildings ?? (raw as { buildings?: unknown }).buildings;

  // Prefer full catalog: derive buildings, vehicle IDs, and traffic-light IDs from it.
  const catalogEntries = normalizeCatalogParam(c.catalog) ?? normalizeCatalogParam(rawCatalog);
  let buildingsFromParams: ReturnType<typeof normalizeBuildingsParam> = null;
  let vehicleIds: string[] | undefined;
  let trafficLightIds: string[] | undefined;

  if (catalogEntries?.length) {
    buildingsFromParams = catalogEntriesToSeedBuildings(catalogEntries);
    vehicleIds = getCatalogIdsByCategory(catalogEntries, CATEGORY_VEHICLES);
    trafficLightIds = getTrafficLightCatalogIds(catalogEntries);
  }

  // Fallback to explicit params (backward compat).
  if (!buildingsFromParams?.length) {
    buildingsFromParams = normalizeBuildingsParam(c.buildings) ?? normalizeBuildingsParam(rawBuildings);
  }
  if (!vehicleIds?.length) {
    vehicleIds = stringArrayParam(c, "vehicleCatalogIds", "vehicle_catalog_ids");
  }
  if (!trafficLightIds?.length) {
    trafficLightIds = stringArrayParam(c, "trafficLightCatalogIds", "traffic_light_catalog_ids");
  }

  // Pyramid cell: disable if explicitly false/none/off.
  const noPyramid =
    c.pyramid === false || c.noPyramid === true || c.pyramid === "none" || c.pyramid === "off";

  const cfg = clampCityConfig({
    gridRows: numParam(c, "rows", "gridRows"),
    gridCols: numParam(c, "cols", "gridCols"),
    blockSize: numParam(c, "blockSize"),
    streetWidth: numParam(c, "streetWidth"),
    buildingSetback: numParam(c, "setback", "buildingSetback"),
    seed: numParam(c, "seed"),
    pyramidRow: numParam(c, "pyramidRow"),
    pyramidCol: numParam(c, "pyramidCol"),
    noPyramid,
  });

  const options: Parameters<typeof generateCityMml>[1] = {};
  if (buildingsFromParams?.length) options.buildings = buildingsFromParams;
  if (vehicleIds?.length) options.vehicleCatalogIds = vehicleIds;
  if (trafficLightIds?.length) options.trafficLightCatalogIds = trafficLightIds;

  return generateCityMml(cfg, Object.keys(options).length > 0 ? options : undefined);
};
