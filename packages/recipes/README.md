# @doppelfun/recipes

## Overview: Doppel documents and MML

In Doppel, a **block** (one engine instance) holds **documents** — versioned blobs of **MML** (scene markup) that the engine parses into world entities. Agents and tools submit MML via the agent document API (`create` / `update` / `append` / `delete`); the server applies the markup and syncs entities into the Colyseus room.

**MML** is XML-style markup for 3D content: elements like `<m-group>`, `<m-cube>`, `<m-model>`, `<m-grass>`, `<m-particle>`, `<m-attr-anim>`, etc. Each entity should have a unique `id`; positions use `x`, `y`, `z` (meters). `<m-model>` references the block catalog via `catalogId`. The engine enforces size and triangle limits per document/block.

This package **generates MML strings only** — no HTTP, no document API. Callers use `DoppelClient` or their own HTTP flow to create/update/append documents; that is outside this package.

---

## Recipe packages

Each recipe is an **isolated folder** under `src/recipes/<id>/` with a **`recipe.json`** (id, name, description, inputs, output) and a **`run(raw)`** function. The loader registers them for Claw’s `list_recipes` and `run_recipe` tools.

| Recipe   | Id       | Purpose |
|----------|----------|--------|
| **Pyramid** | `pyramid` | Hollow stepped pyramid (`m-cube` shell, doorway, glowing corners). |
| **City**   | `city`    | Street grid + seed buildings, optional pyramid cell; street lights and vehicles. |
| **Grass**  | `grass`  | Multiple `m-grass` patches in block bounds; neon palette + optional emission. |
| **Trees**  | `trees`  | Random `m-model` placements with `catalogId` (e.g. def-tree, def-pine-trees). |

Recipes are **pure** (no I/O in core): `raw.params` in → MML string out. City catalog helpers are re-exported so Claw can build city params from the block catalog.

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
  runProceduralMml,
  listProceduralKinds,
  getRecipeManifests,
} from "@doppelfun/recipes";

const kinds = listProceduralKinds(); // ["pyramid", "city", "grass", "trees"]
const mml = runProceduralMml("pyramid", { kind: "pyramid", params: { baseWidth: 30, layers: 15, seed: 99 } });
const manifests = getRecipeManifests(); // recipe.json-style metadata for tool registration
```

- **Dispatch:** `runProceduralMml(kind, raw)` — `raw.params` holds kind-specific options. `listProceduralKinds()` returns registered ids. `getRecipeManifests()` returns each recipe’s id, name, description, and inputs (for Claw to register tools).
- **City catalog:** Claw builds city params from the block catalog using re-exported `catalogEntriesToSeedBuildings`, `getCatalogIdsByCategory`, `getTrafficLightCatalogIds`, `CATEGORY_VEHICLES`.

---

## Adding a new recipe

See **[CONTRIBUTING.md](./CONTRIBUTING.md)**. In short: add `src/recipes/<id>/` with `recipe.json`, `index.ts` (export `recipeManifest` + `run`), and self-contained config/service/prng; then register in `src/loader.ts`. Claw does not need changes.

---

**Hub catalog (city):** Claw loads the block catalog and uses the re-exported helpers `catalogEntriesToSeedBuildings`, `getCatalogIdsByCategory`, `getTrafficLightCatalogIds` to build `params.buildings`, `params.vehicleCatalogIds`, and `params.trafficLightCatalogIds` before calling `runProceduralMml("city", raw)`. The city recipe uses that pool; if `buildings` is omitted or empty, layout has no buildings.
