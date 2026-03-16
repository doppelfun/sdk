/**
 * Recipe loader: auto-discovers recipe folders under recipes/ and builds a registry.
 *
 * - Scans the recipes/ directory (next to this file in dist/) for subdirectories.
 * - Each subdirectory is loaded via dynamic import; if it exports recipeManifest and run,
 *   it is registered. Folders that fail to load or don't export both are skipped.
 * - Uses top-level await so discovery runs once when the package is first imported.
 */

import { readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { RecipeManifest, RecipeRunner } from "./types.js";

/** A loaded recipe: manifest (from recipe.json) + run function. */
export type RecipeEntry = { manifest: RecipeManifest; run: RecipeRunner };

// Resolve recipes dir relative to this module (works from dist/ after build).
const loaderDir = dirname(fileURLToPath(import.meta.url));
const recipesDir = join(loaderDir, "recipes");

/**
 * Scan recipesDir for subdirectories and dynamically import each as a recipe module.
 * Only directories that export both recipeManifest and run are included.
 */
async function loadRecipes(): Promise<RecipeEntry[]> {
  const entries = readdirSync(recipesDir, { withFileTypes: true });
  const loaded: RecipeEntry[] = [];

  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;

    try {
      const mod = await import(`./recipes/${e.name}/index.js`);
      if (mod?.recipeManifest && typeof mod.run === "function") {
        loaded.push({ manifest: mod.recipeManifest, run: mod.run });
      }
    } catch {
      // Not a valid recipe module (e.g. missing index or invalid export); skip.
    }
  }

  return loaded;
}

const RECIPES = await loadRecipes();

/** Build kind → run map; throws if duplicate recipe id. */
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

/**
 * Run a recipe by kind. raw must contain kind at top level and params under raw.params.
 * @throws if kind is unknown
 */
export function runProceduralMml(kind: string, raw: Record<string, unknown>): string {
  const k = kind.trim().toLowerCase();
  const handler = HANDLERS[k];
  if (!handler) {
    const known = Object.keys(HANDLERS).join(", ");
    throw new Error(`Unknown recipe kind "${kind}". Known kinds: ${known}`);
  }
  return handler(raw);
}

/** List all registered recipe ids (e.g. for claw list_recipes tool). */
export function listProceduralKinds(): string[] {
  return Object.keys(HANDLERS);
}

/** All recipe manifests for tool registration (inputs/outputs from recipe.json). */
export function getRecipeManifests(): RecipeManifest[] {
  return RECIPES.map((r) => r.manifest);
}
