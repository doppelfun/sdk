/**
 * @doppelfun/recipes — pure recipe packages.
 *
 * Recipes live under src/recipes/<id>/ with recipe.json and a run() function.
 * The loader registers all built-in recipes; claw uses listRecipes(), runRecipe(), and
 * getRecipeManifests() for list_recipes / run_recipe tools.
 */

export {
  runRecipe,
  listRecipes,
  getRecipeManifests,
  type RecipeEntry,
} from "./loader.js";

export type { RecipeManifest, RecipeRunner, RecipeInput, RecipeInjectKey, RecipeOutputType } from "./types.js";
export { RECIPE_INJECT_KEYS } from "./types.js";
