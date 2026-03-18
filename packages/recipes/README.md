# Doppel Recipes

**Recipes** are pure, discoverable generators: parameters in → string out (MML, message, or JSON). They are used by [@doppelfun/claw](https://github.com/doppelfun/sdk/tree/main/packages/claw) for the `list_recipes` and `run_recipe` tools so agents can generate scenes or get data without calling an LLM.

---

## What is a recipe?

A **recipe** is a small, self-contained module that takes a `raw` payload (e.g. `kind` + `params`) and returns a string. Each recipe lives in its own folder under `src/recipes/<id>/`, with:

- **`recipe.json`** — id, name, description, inputs, **output** (`"mml"` | `"message"` | `"json"`), and optional **`inject`** (array of allowed keys; see below).
- **`run(raw)`** — a function that computes the output string from `raw.params` (and any injected state). Recipes are **synchronous and pure** in core: no I/O inside the recipe; the runner may inject state before calling `run`.

**Injectable state:** Only the keys listed below can be injected. A recipe may request any subset in `inject`; the runner ignores any other key. No arbitrary keys are supported.

| Key               | Injected as              | Description |
|-------------------|--------------------------|-------------|
| `catalog`         | `params.catalog`         | Block catalog: array of entries (id, name, url, category, width, depth, height, triangleCount?). |
| `currentDocument` | `params.currentDocument` | Current block document MML string, or null if none. |
| `occupants`       | `params.occupants`       | Occupants in the block: array of { clientId, userId, username, type, position? }. |

**Output types:** `mml` — scene markup; the runner writes it to a document. `message` — raw text for the LLM (e.g. instruction or reply); the runner returns it to the agent. `json` — JSON string; the runner returns it to the agent. Only `mml` triggers a document create/update/append.

The loader **auto-discovers** recipe folders at package load time and registers them. No edits to the loader are needed when adding a recipe. Callers use `listRecipes()` to get recipe ids, `getRecipeManifests()` for tool registration (names, descriptions, inputs), and `runRecipe(kind, raw)` to execute one.

---

## MML and Doppel documents

In Doppel, a **block** (one engine instance) holds **documents** — versioned blobs of **MML** (scene markup) that the engine parses into world entities. Agents and tools submit MML via the document API (`create` / `update` / `append` / `delete`); the server applies the markup and syncs entities into the room.

**MML** is XML-style markup for 3D content: elements like `<m-group>`, `<m-cube>`, `<m-model>`, `<m-grass>`, `<m-particle>`, `<m-attr-anim>`, etc. Each entity should have a unique `id`; positions use `x`, `y`, `z` (meters). `<m-model>` references the block catalog via `catalogId`. The engine enforces size and triangle limits per document/block.

This package **only produces strings** (MML, message, or JSON per recipe) — it does not perform HTTP or document API calls. For `output: "mml"`, callers (e.g. claw’s `run_recipe` handler) use `DoppelClient` or their own flow to create/update/append documents. For `message` or `json`, the runner returns the string to the agent.

---

## Recipe packages

| Recipe   | Id       | Purpose |
|----------|----------|--------|
| **Pyramid** | `pyramid` | Hollow stepped pyramid (`m-cube` shell, doorway, glowing corners). |
| **City**   | `city`    | Street grid + seed buildings, optional pyramid cell; street lights and vehicles. Uses `inject: ["catalog"]`; pass full catalog in `params.catalog` or let the runner inject it. |
| **Grass**  | `grass`  | Multiple `m-grass` patches in block bounds; neon palette + optional emission. |
| **Trees**  | `trees`  | Random `m-model` placements with `catalogId` (e.g. def-tree, def-pine-trees). |

---

## Build

From **doppel-sdk** root:

```bash
pnpm install
pnpm --filter @doppelfun/recipes run build
```

---

## Usage (library)

```ts
import {
  runRecipe,
  listRecipes,
  getRecipeManifests,
} from "@doppelfun/recipes";

const kinds = listRecipes(); // ["pyramid", "city", "grass", "trees"]
const mml = runRecipe("pyramid", { kind: "pyramid", params: { baseWidth: 30, layers: 15, seed: 99 } });
const manifests = getRecipeManifests(); // recipe.json-style metadata for tool registration
```

- **Dispatch:** `runRecipe(kind, raw)` — `raw.params` holds kind-specific options. `listRecipes()` returns registered ids. `getRecipeManifests()` returns each recipe’s id, name, description, and inputs (for tool registration). Recipes that list `inject: ["catalog"]` receive the block catalog in `params.catalog` when the runner injects it; only allowed inject keys are honored (see Injectable state above).

---

## Adding a new recipe

See **[CONTRIBUTING.md](./CONTRIBUTING.md)**. In short: add `src/recipes/<id>/` with `recipe.json`, `index.ts` (export `recipeManifest` + `run`), and self-contained config/service; the loader auto-discovers it. Claw does not need code changes.
