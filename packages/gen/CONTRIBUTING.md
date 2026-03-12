# Contributing procedurals to `@doppelfun/gen`

**You do not need to change Claw (or any other package).**  
Claw’s `generate_procedural` tool calls `runProceduralMml(kind, args)` from this package. New kinds work as soon as they are registered here and the app depends on a gen version that includes your PR.

## Scope: this package only

| Package        | Touch for a new procedural? |
|----------------|-----------------------------|
| **@doppelfun/gen** | **Yes** — add generator + register |
| **@doppelfun/claw** | **No** — stable tool + Zod already accept any `kind` + `params` |
| **doppel-engine / app** | Only if you need new engine APIs (optional) |

## Steps (checklist)

1. **Add `src/<kind>/`** (lowercase kind name matches `runProceduralMml` lookup):
   - `config.ts` — config type, defaults, `clamp*Config(partial)` for safe bounds.
   - `service.ts` — `generate<Kind>Mml(config): string`, **no I/O** (pure MML string out).

2. **Re-export** from `src/index.ts` (types + generator) so others can call your API directly.

3. **Register** in `src/procedural.ts`:
   - Handler receives `raw`; read **`raw.params`** only (object with your option keys). Top-level is reserved for `kind` / `documentMode`.
   - **Append** one `{ kind: "<kind>", run: yourHandler }` to `PROCEDURAL_REGISTRY` at the bottom of that file.

4. **Build & test**
   - `pnpm --filter @doppelfun/gen run build`
   - Optional: unit test your service with fixed config → snapshot or string includes.

5. **PR description**
   - Kind name (e.g. `forest`).
   - Short param summary (what goes in `params` for `generate_procedural`).
   - Any new dependencies (prefer avoiding engine `file:` deps when possible).

## Contract for handlers

- **Input:** `raw.params` is the only place for kind-specific options; top-level `kind` / `documentMode` are set by the caller.
- **Output:** `string` — raw MML only (no markdown fences).
- **Spatial bounds:** Generated MML must place geometry **inside the block** — **100×100 m** per slot (`BLOCK_SIZE_M` from `@doppel-engine/schema`). Every **x** must satisfy **xMin ≤ x < xMax** and every **z** **zMin ≤ z < zMax** for the target block; otherwise the scene is invisible where the player stands. City layout helpers already offset by `BLOCK_SIZE_M / 2` when centering.
- **Glow:** Use **`emission`** and **`emission-intensity`** on cubes/models if needed — the client does not read **`emissive`**.
- **Errors:** throw `Error` with a clear message; Claw surfaces it to the agent.

## Stable API used by Claw (do not break)

- `runProceduralMml(kind: string, raw: Record<string, unknown>): string`
- `listProceduralKinds(): string[]`

Callers may also import your `generate*Mml` and clamps directly; keep those exports backward compatible when possible.

## Questions

Open an issue or draft PR early if you’re unsure about config shape or engine dependencies.
