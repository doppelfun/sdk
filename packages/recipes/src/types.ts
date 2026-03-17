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

/**
 * Injectable state: the only keys a recipe may request in manifest.inject.
 * The runner injects only these; any other key in recipe.json is ignored.
 *
 * | Key               | Injected into params      | Description |
 * |-------------------|---------------------------|-------------|
 * | `catalog`         | `params.catalog`          | Block catalog: array of entries (id, name, url, category, width, depth, height, triangleCount?). |
 * | `currentDocument` | `params.currentDocument`  | Current block document MML string, or null if none. |
 * | `occupants`       | `params.occupants`        | Occupants in the block: array of { clientId, userId, username, type, position? }. |
 *
 * No other keys can be injected. To add one, extend this type and the runner implementation.
 */
export type RecipeInjectKey = "catalog" | "currentDocument" | "occupants";

/** Allowed inject keys (runtime allowlist). Runner must only inject keys in this set. */
export const RECIPE_INJECT_KEYS: readonly RecipeInjectKey[] = [
  "catalog",
  "currentDocument",
  "occupants",
];

/**
 * Recipe output type. Determines how the runner/handler uses the string returned by run().
 * - "mml" — scene markup; runner typically writes to a document.
 * - "message" — raw text for the LLM (e.g. instruction or reply); runner returns it to the agent.
 * - "json" — JSON string; runner may parse and use or return to the agent.
 */
export type RecipeOutputType = "mml" | "message" | "json";

/** Manifest from recipe.json: id, name, description, inputs, output. Used by claw for tool registration. */
export type RecipeManifest = {
  id: string;
  name: string;
  description: string;
  inputs: RecipeInput[];
  output: RecipeOutputType;
  /** Keys of state to inject into params. Only keys in RecipeInjectKey are honored; others are ignored. */
  inject?: RecipeInjectKey[];
};

/** Function that runs a recipe: takes raw (kind + params) and returns a string (content depends on manifest.output). */
export type RecipeRunner = (raw: Record<string, unknown>) => string;
