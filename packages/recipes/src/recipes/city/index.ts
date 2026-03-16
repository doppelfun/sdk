/**
 * City recipe: street grid, buildings, optional pyramid cell, lights, vehicles.
 * Exports recipeManifest (from recipe.json) and run for the loader.
 * run() normalizes raw.params (including buildings/vehicleCatalogIds from catalog) and calls generateCityMml.
 */
import manifestJson from "./recipe.json" with { type: "json" };
import type { RecipeManifest, RecipeRunner } from "../../types.js";
import { generateCityMml } from "./service.js";
import { clampCityConfig } from "./config.js";
import { normalizeBuildingsParam } from "./layout/index.js";

const manifest = manifestJson as RecipeManifest;
export const recipeManifest = manifest;

/** Extract params from raw; top-level params object or empty. */
function getParams(raw: Record<string, unknown>): Record<string, unknown> {
  const p = raw.params;
  if (p && typeof p === "object" && !Array.isArray(p)) return p as Record<string, unknown>;
  return {};
}

export const run: RecipeRunner = (raw: Record<string, unknown>): string => {
  const c = getParams(raw);

  // Buildings: from params or top-level (claw may pass from catalog).
  const buildingsFromParams =
    normalizeBuildingsParam(c.buildings) ?? normalizeBuildingsParam((raw as { buildings?: unknown }).buildings);

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

  // Optional catalog id arrays (accept both camelCase and snake_case).
  const vehicleIds =
    Array.isArray(c.vehicleCatalogIds) && c.vehicleCatalogIds.every((id): id is string => typeof id === "string")
      ? c.vehicleCatalogIds
      : Array.isArray(c.vehicle_catalog_ids) && c.vehicle_catalog_ids.every((id): id is string => typeof id === "string")
        ? c.vehicle_catalog_ids
        : undefined;
  const trafficLightIds =
    Array.isArray(c.trafficLightCatalogIds) &&
    c.trafficLightCatalogIds.every((id): id is string => typeof id === "string")
      ? c.trafficLightCatalogIds
      : Array.isArray(c.traffic_light_catalog_ids) &&
          c.traffic_light_catalog_ids.every((id): id is string => typeof id === "string")
        ? c.traffic_light_catalog_ids
        : undefined;

  const options: Parameters<typeof generateCityMml>[1] = {};
  if (buildingsFromParams?.length) options.buildings = buildingsFromParams;
  if (vehicleIds?.length) options.vehicleCatalogIds = vehicleIds;
  if (trafficLightIds?.length) options.trafficLightCatalogIds = trafficLightIds;

  return generateCityMml(cfg, Object.keys(options).length > 0 ? options : undefined);
};
