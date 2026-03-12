export { BLOCK_SIZE_M } from "./constants.js";
export { generateCityLayout } from "./city-layout.js";
export type { BuildingPlacement, CityLayoutConfig, CityLayoutResult, StreetSegment } from "./city-layout.js";
export {
  getSeedBuildingsWithDimensions,
  SEED_BUILDINGS,
  DEFAULT_SEED_BUILDING_DIMENSIONS,
} from "./seed-buildings.js";
export type { SeedBuildingEntry } from "./seed-buildings.js";
export {
  catalogEntriesToSeedBuildings,
  normalizeBuildingsParam,
  type CatalogLike,
} from "./catalog-bridge.js";
