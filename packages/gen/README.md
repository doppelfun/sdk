# @doppelfun/gen

## Overview: Doppel documents and MML

In Doppel, a **block** (one engine instance) holds **documents** — versioned blobs of **MML** (scene markup) that the engine parses into world entities. Agents and tools submit MML via the agent document API (`create` / `update` / `append` / `delete`); the server applies the markup and syncs entities into the Colyseus room.

**MML** is XML-style markup for 3D content: elements like `<m-group>`, `<m-cube>`, `<m-model>`, `<m-grass>`, `<m-particle>`, `<m-attr-anim>`, etc. Each entity should have a unique `id`; positions use `x`, `y`, `z` (meters). `<m-model>` references the block catalog via `catalogId`. The engine enforces size and triangle limits per document/block.

This package **generates MML strings only** — no HTTP, no document API. Callers use `DoppelClient` or their own HTTP flow to create/update/append documents; that is outside this package.

---

## Generators in this package

| Generator | Export | Purpose |
|-----------|--------|--------|
| **Pyramid** | `generatePyramidMml` | Hollow stepped pyramid (`m-cube` shell, doorway, glowing corners). |
| **City** | `generateCityMml` | Street grid + seed buildings (`m-model` by `catalogId`), optional pyramid cell. |

Core services are **pure** (no `fetch`, no `process.exit`): config in → MML string out.

---

## Build

Gen depends on `doppel-engine` packages via `file:` paths. From **doppel-sdk** root:

```bash
pnpm install --no-frozen-lockfile
pnpm --filter @doppelfun/gen run build
```

---

## Usage (library)

```ts
import {
  generatePyramidMml,
  generateCityMml,
  runProceduralMml,
  listProceduralKinds,
  clampPyramidConfig,
  clampCityConfig,
} from "@doppelfun/gen";

const pyramidMml = generatePyramidMml({ baseWidth: 30, layers: 15, seed: 99 });
const cityMml = generateCityMml({ gridRows: 6, gridCols: 6, seed: 42 });
```

- **Pyramid** — `PyramidGenConfig`: `baseWidth`, `layers`, `blockSize`, `doorWidthBlocks`, `seed`, `cx`, `cz` (see `src/pyramid/config.ts` / `DEFAULT_PYRAMID_CONFIG`).
- **City** — `CityGenConfig`: `gridRows`, `gridCols`, `blockSize`, `streetWidth`, `buildingSetback`, `seed`, optional `pyramidRow` / `pyramidCol` (see `src/city/config.ts`).

Use `clampPyramidConfig` / `clampCityConfig` on partial input before generating.

**Dispatch:** `runProceduralMml(kind, raw)` — `raw.params` holds kind-specific options (pyramid/city fields go inside `params`). `listProceduralKinds()` lists registered kinds (`city`, `pyramid`). Claw’s Zod tool schema normalizes common LLM variants (e.g. `procedural-city` → `city`) before calling here.

---

## Adding a new generator

**Open-source / external PRs:** touch **this package only**. See **[CONTRIBUTING.md](./CONTRIBUTING.md)** for the checklist. Claw’s `generate_procedural` already forwards `kind` + `params` to `runProceduralMml`; registering a new kind in `src/procedural.ts` is enough.

Anyone can add another procedural by following the same pattern as `pyramid/` and `city/`:

1. **Add a folder** under `src/<name>/` with:
   - **`config.ts`** — Export a config type, `DEFAULT_*_CONFIG`, and `clamp*Config(partial)` so callers and tools get safe bounds without duplicating validation.
   - **`service.ts`** — Export `generate<Name>Mml(config): string` (and helpers like `*BlockCount` if useful). **No I/O** inside — only sync logic, PRNG from `shared/prng.js` if needed.
2. **Re-export** from `src/index.ts` (types, defaults, clamp, main generator).
3. **Register** — append `{ kind: "<kind>", run: yourHandler }` to **`PROCEDURAL_REGISTRY`** in `src/procedural.ts`. Claw does not need changes; bump gen version / dependency when shipping.
4. **Wire other callers (optional)** — scripts can still call your generator directly; gen stays unaware of documents.
5. **Dependencies** — Prefer keeping new generators free of engine `file:` deps when possible; if you need layout or assets, either depend on `@doppel-engine/assets` / schema like city does, or inject data via config from the caller.

Pyramid is the minimal template (config + service + shared PRNG only). City shows how to combine engine layout helpers with MML emission.

---

## Dependencies

- **Pyramid** — no engine runtime; only shared PRNG/helpers.
- **City** — uses `@doppel-engine/assets` (layout + seed buildings) and `@doppel-engine/schema` (`BLOCK_SIZE_M`). Linked via `file:`; package is **monorepo-only** until city layout is extracted.

Catalog-aware placement can use `@doppelfun/sdk` (`getBlockCatalog`, etc.) in the caller; city layout still uses fixed seed building catalog IDs from assets.
