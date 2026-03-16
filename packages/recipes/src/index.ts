/**
 * @doppelfun/recipes — MML recipe packages.
 *
 * Recipes are isolated folders under src/recipes/<id>/ with recipe.json and a run() function.
 * The loader auto-discovers them; claw uses listProceduralKinds(), runProceduralMml(), and
 * getRecipeManifests() for list_recipes / run_recipe tools.
 *
 * City catalog helpers are re-exported so claw can build city params from the block catalog.
 */

export {
  runProceduralMml,
  listProceduralKinds,
  getRecipeManifests,
  type RecipeEntry,
} from "./loader.js";

export type { RecipeManifest, RecipeRunner, RecipeInput } from "./types.js";

export {
  catalogEntriesToSeedBuildings,
  getCatalogIdsByCategory,
  getTrafficLightCatalogIds,
  CATEGORY_VEHICLES,
} from "./recipes/city/layout/catalog-bridge.js";
