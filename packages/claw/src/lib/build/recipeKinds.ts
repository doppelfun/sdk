/**
 * Single source for recipe ids from @doppelfun/recipes.
 * Used by build schemas, tool descriptions, and list_recipes handler so listRecipes() is called once at load time.
 */
import { listRecipes } from "@doppelfun/recipes";

/** Registered recipe ids (e.g. ["city", "pyramid", "grass", "trees"]). */
export const RECIPE_KINDS = listRecipes();

/** Comma-separated list for error messages and tool descriptions. */
export const RECIPE_KINDS_LIST =
  RECIPE_KINDS.length > 0 ? RECIPE_KINDS.join(", ") : "(none registered)";
