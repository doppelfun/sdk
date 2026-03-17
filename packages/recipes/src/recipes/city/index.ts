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

/** Normalize catalog param to CatalogLike[] or null. */
function normalizeCatalogParam(raw: unknown): CatalogLike[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: CatalogLike[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    if (!id) continue;
    out.push({
      id,
      name: typeof o.name === "string" ? o.name : undefined,
      url: typeof o.url === "string" ? o.url : undefined,
      category: typeof o.category === "string" ? o.category : undefined,
      assetType: typeof (o as { assetType?: unknown }).assetType === "string" ? (o as { assetType: string }).assetType : undefined,
      width: typeof o.width === "number" ? o.width : (o.width as null) === null ? null : undefined,
      depth: typeof o.depth === "number" ? o.depth : (o.depth as null) === null ? null : undefined,
      height: typeof o.height === "number" ? o.height : (o.height as null) === null ? null : undefined,
    });
  }
  return out.length > 0 ? out : null;
}

export const run: RecipeRunner = (raw: Record<string, unknown>): string => {
  const c = getParams(raw);

  // If full catalog is passed, parse it to buildings, vehicleCatalogIds, trafficLightCatalogIds.
  const catalogEntries = normalizeCatalogParam(c.catalog) ?? normalizeCatalogParam((raw as { catalog?: unknown }).catalog);
  let buildingsFromParams: ReturnType<typeof normalizeBuildingsParam> = null;
  let vehicleIds: string[] | undefined;
  let trafficLightIds: string[] | undefined;

  if (catalogEntries && catalogEntries.length > 0) {
    buildingsFromParams = catalogEntriesToSeedBuildings(catalogEntries);
    vehicleIds = getCatalogIdsByCategory(catalogEntries, CATEGORY_VEHICLES);
    trafficLightIds = getTrafficLightCatalogIds(catalogEntries);
  }

  // Otherwise fall back to explicit params (backward compat).
  if (!buildingsFromParams?.length) {
    buildingsFromParams =
      normalizeBuildingsParam(c.buildings) ?? normalizeBuildingsParam((raw as { buildings?: unknown }).buildings);
  }
  if (!vehicleIds?.length) {
    vehicleIds =
      Array.isArray(c.vehicleCatalogIds) && c.vehicleCatalogIds.every((id): id is string => typeof id === "string")
        ? c.vehicleCatalogIds
        : Array.isArray(c.vehicle_catalog_ids) && c.vehicle_catalog_ids.every((id): id is string => typeof id === "string")
          ? c.vehicle_catalog_ids
          : undefined;
  }
  if (!trafficLightIds?.length) {
    trafficLightIds =
      Array.isArray(c.trafficLightCatalogIds) &&
      c.trafficLightCatalogIds.every((id): id is string => typeof id === "string")
        ? c.trafficLightCatalogIds
        : Array.isArray(c.traffic_light_catalog_ids) &&
            c.traffic_light_catalog_ids.every((id): id is string => typeof id === "string")
          ? c.traffic_light_catalog_ids
          : undefined;
  }

  // Pyramid cell: disable if explicitly false/none/off.
  const noPyramid =
    c.pyramid === false || c.noPyramid === true || c.pyramid === "none" || c.pyramid === "off";

  const cfg = clampCityConfig({
    gridRows: typeof c.rows === "number" ? c.rows : typeof c.gridRows === "number" ? c.gridRows : undefined,
    gridCols: typeof c.cols === "number" ? c.cols : typeof c.gridCols === "number" ? c.gridCols : undefined,
    blockSize: typeof c.blockSize === "number" ? c.blockSize : undefined,
    streetWidth: typeof c.streetWidth === "number" ? c.streetWidth : undefined,
    buildingSetback:
      typeof c.setback === "number" ? c.setback : typeof c.buildingSetback === "number" ? c.buildingSetback : undefined,
    seed: typeof c.seed === "number" ? c.seed : undefined,
    pyramidRow: typeof c.pyramidRow === "number" ? c.pyramidRow : undefined,
    pyramidCol: typeof c.pyramidCol === "number" ? c.pyramidCol : undefined,
    noPyramid,
  });

  const options: Parameters<typeof generateCityMml>[1] = {};
  if (buildingsFromParams?.length) options.buildings = buildingsFromParams;
  if (vehicleIds?.length) options.vehicleCatalogIds = vehicleIds;
  if (trafficLightIds?.length) options.trafficLightCatalogIds = trafficLightIds;

  return generateCityMml(cfg, Object.keys(options).length > 0 ? options : undefined);
};
