export { BLOCK_SIZE_M } from "./constants.js";
export { generateCityLayout } from "./city-layout.js";
export type { BuildingPlacement, CityLayoutConfig, CityLayoutResult, StreetSegment } from "./city-layout.js";
export type { SeedBuildingEntry } from "./catalog-bridge.js";
export {
  catalogEntriesToSeedBuildings,
  fetchCityCatalogFromHub,
  getCatalogIdsByCategory,
  getTrafficLightCatalogIds,
  CATEGORY_VEHICLES,
  normalizeBuildingsParam,
  type CatalogLike,
  type CityCatalogFromHub,
} from "./catalog-bridge.js";
