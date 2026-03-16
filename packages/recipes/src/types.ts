/**
 * Shared types for recipe manifests and runners.
 * recipe.json in each recipe folder conforms to RecipeManifest.
 */

/** Describes one input parameter for a recipe (for tool registration / docs). */
export type RecipeInput = {
  name: string;
  type: "number" | "string" | "boolean" | "array" | "object";
  optional?: boolean;
  description?: string;
};

/** Manifest from recipe.json: id, name, description, inputs, output. Used by claw for tool registration. */
export type RecipeManifest = {
  id: string;
  name: string;
  description: string;
  inputs: RecipeInput[];
  output: "mml";
};

/** Function that runs a recipe: takes raw (kind + params) and returns MML string. */
export type RecipeRunner = (raw: Record<string, unknown>) => string;
