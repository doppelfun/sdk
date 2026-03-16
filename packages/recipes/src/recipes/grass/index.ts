/**
 * Grass recipe: m-grass patches in block bounds.
 * Exports recipeManifest (from recipe.json) and run for the loader.
 */
import manifestJson from "./recipe.json" with { type: "json" };
import type { RecipeManifest, RecipeRunner } from "../../types.js";
import { run as runImpl } from "./service.js";

const manifest = manifestJson as RecipeManifest;
export const recipeManifest = manifest;
export const run: RecipeRunner = runImpl;
