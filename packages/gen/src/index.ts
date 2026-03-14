/**
 * @doppelfun/gen — procedural MML generators. No I/O in core services.
 *
 * Claw integration: only runProceduralMml + listProceduralKinds are required.
 * New procedurals = gen-only PR (see CONTRIBUTING.md) — do not edit Claw.
 */

export { generatePyramidMml, pyramidBlockCount } from "./pyramid/service.js";
export {
  type PyramidGenConfig,
  DEFAULT_PYRAMID_CONFIG,
  clampPyramidConfig,
} from "./pyramid/config.js";

export {
  generateCityMml,
  generateCityMmlFromCatalog,
  type GenerateCityMmlOptions,
} from "./city/service.js";
export {
  catalogEntriesToSeedBuildings,
  fetchBuildingsFromCatalog,
  normalizeBuildingsParam,
  type CatalogLike,
} from "./city/layout/catalog-bridge.js";
export {
  type CityGenConfig,
  DEFAULT_CITY_CONFIG,
  clampCityConfig,
} from "./city/config.js";

export { generateGrassMml, grassPatchCount } from "./grass/service.js";
export {
  type GrassGenConfig,
  DEFAULT_GRASS_CONFIG,
  clampGrassConfig,
} from "./grass/config.js";

export { generateTreesMml, treesEntityCount } from "./trees/service.js";
export {
  type TreesGenConfig,
  DEFAULT_TREES_CONFIG,
  clampTreesConfig,
} from "./trees/config.js";

export { mulberry32, r2, deg } from "./shared/prng.js";

export { getModelDimensionsFromDocument, type ModelDimensions } from "./model-dimensions.js";

export {
  runProceduralMml,
  listProceduralKinds,
  type ProceduralHandler,
  type ProceduralEntry,
} from "./procedural.js";
