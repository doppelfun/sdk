# Contributing recipes to `@doppelfun/recipes`

**You do not need to change Claw (or any other package).**  
Claw’s `run_recipe` tool calls `runRecipe(kind, raw)` from this package. New recipes are **auto-discovered**: add a folder under `src/recipes/<id>/` and the loader will pick it up (no edits to `loader.ts`).

## Scope: this package only

| Package              | Touch for a new recipe? |
|----------------------|-------------------------|
| **@doppelfun/recipes** | **Yes** — add recipe folder only |
| **@doppelfun/claw**    | **No** — stable tool + schema accept any `kind` + `params` |

## Recipe structure (isolated package)

Each recipe is an **isolated folder** under `src/recipes/<id>/` with:

1. **`recipe.json`** — Manifest for doppel claw registration:
   - `id` (string) — kind name, e.g. `"pyramid"`
   - `name` (string) — display name
   - `description` (string) — short description
   - `inputs` (array) — `{ name, type, optional?, description? }` per input
   - `output` — `"mml"` (write to document), `"message"` (return to LLM), or `"json"` (return to agent)
   - `inject` (optional) — array of **allowed keys only** (see types: `RecipeInjectKey`). Supported: `"catalog"` → `params.catalog`, `"currentDocument"` → `params.currentDocument` (MML or null), `"occupants"` → `params.occupants`. Any other key is ignored.

2. **`index.ts`** — Exports `recipeManifest` (from recipe.json) and `run(raw): string`.

3. **Recipe code** — Self-contained: `config.ts`, `service.ts`, and any helpers (e.g. `prng.ts`). No shared parent code; each recipe can duplicate small utilities (e.g. PRNG) to stay isolated.

The **loader** scans `recipes/` at startup and loads any folder that exports `recipeManifest` and `run`. No registration step.

## Steps (checklist)

1. **Add `src/recipes/<id>/`** (e.g. `src/recipes/forest/`):
   - `recipe.json` — id, name, description, inputs, output.
   - `prng.ts` (if needed) — local PRNG helpers.
   - `config.ts` — config type, defaults, `clamp*Config(partial)`.
   - `service.ts` — `generate*Mml(config): string` and `run(raw): string` (read `raw.params`, clamp config, call generator).
   - `index.ts` — `import recipe.json`; export `recipeManifest` and `run`.

2. **Build & test**
   - `pnpm --filter @doppelfun/recipes run build`
   - Optional: unit test your service with fixed config.

4. **PR description** — Kind name, param summary, any new deps.

## Contract for `run(raw)`

- **Input:** `raw.params` is the only place for kind-specific options; top-level `kind` / `documentMode` are set by the caller.
- **Output:** `string` — content depends on manifest `output`: for `mml` use raw MML (no markdown fences); for `message` or `json` use that format. The runner uses `output` to decide whether to write a document or return the string to the agent.
- **Spatial bounds:** Generated MML must place geometry **inside the block** — **100×100 m** per slot. Every **x** must satisfy **xMin ≤ x < xMax** and every **z** **zMin ≤ z < zMax** for the target block.
- **Errors:** throw `Error` with a clear message; Claw surfaces it to the agent.

## Stable API used by Claw (do not break)

- `runRecipe(kind: string, raw: Record<string, unknown>): string`
- `listRecipes(): string[]`
- `getRecipeManifests(): RecipeManifest[]` — for tool registration (inputs/outputs from recipe.json).
