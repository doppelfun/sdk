/**
 * Recipe registry: known recipes under recipes/<id>/ with recipe.json and run().
 *
 * Static imports avoid top-level await so tools like tsx (esbuild CJS transform) and
 * other bundlers can load this package without "Top-level await is not supported with cjs".
 */

import type { RecipeManifest, RecipeRunner } from "./types.js";

/** A loaded recipe: manifest (from recipe.json) + run function. */
export type RecipeEntry = { manifest: RecipeManifest; run: RecipeRunner };

import { recipeManifest as cityManifest, run as runCity } from "./recipes/city/index.js";
import { recipeManifest as grassManifest, run as runGrass } from "./recipes/grass/index.js";
import { recipeManifest as pyramidManifest, run as runPyramid } from "./recipes/pyramid/index.js";
import { recipeManifest as treesManifest, run as runTrees } from "./recipes/trees/index.js";

const RECIPES: RecipeEntry[] = [
  { manifest: cityManifest, run: runCity },
  { manifest: grassManifest, run: runGrass },
  { manifest: pyramidManifest, run: runPyramid },
  { manifest: treesManifest, run: runTrees },
];

/** kind (lowercase id) → run function. Throws on duplicate id. */
function buildHandlerMap(): Record<string, RecipeRunner> {
  const map: Record<string, RecipeRunner> = {};
  for (const { manifest, run } of RECIPES) {
    const kind = manifest.id.trim().toLowerCase();
    if (map[kind]) throw new Error(`Duplicate recipe id "${kind}"`);
    map[kind] = run;
  }
  return map;
}

const HANDLERS = buildHandlerMap();

/** Run a recipe by kind. raw must include kind and params; returns string (MML, message, or JSON per manifest.output). */
export function runRecipe(kind: string, raw: Record<string, unknown>): string {
  const k = kind.trim().toLowerCase();
  const handler = HANDLERS[k];
  if (!handler) {
    throw new Error(`Unknown recipe kind "${kind}". Known: ${Object.keys(HANDLERS).join(", ")}`);
  }
  return handler(raw);
}

/** Registered recipe ids (for list_recipes / schema validation). */
export function listRecipes(): string[] {
  return Object.keys(HANDLERS);
}

/** Manifests for tool registration and inject (e.g. catalog) lookup. */
export function getRecipeManifests(): RecipeManifest[] {
  return RECIPES.map((r) => r.manifest);
}
