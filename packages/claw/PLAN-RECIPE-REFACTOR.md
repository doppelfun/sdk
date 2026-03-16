# Plan: Remove Build Subagent, Add Build/Recipe Tools to Obedient Agent

This plan does two things: (1) remove the build subagent and make build capabilities **callable tools with strict input/output** on the Obedient agent; (2) rename the **gen** package to **recipes** and add the recipe (build) tools to the Obedient agent. Autonomous agent is unchanged for now (no build tools).

---

## 1. Goals

- **No build subagent:** Remove the nested Build subagent and `run_build`. Build actions are direct tool calls on the Obedient agent.
- **Strict input/output:** Each build tool has a **Zod schema** for arguments and returns a **deterministic result** (`{ ok: true, summary }` or `{ ok: false, error }`). No free-form subagent conversation.
- **Rename gen → recipes:** Package `@doppelfun/gen` becomes `@doppelfun/recipes`. Procedural generation (city, pyramid, grass, trees) lives in recipes; claw depends on recipes and calls it from the `run_recipe` tool. The agent can discover recipes via `list_recipes`.
- **Obedient agent only (for now):** The new build/recipe tools are added to the Obedient agent. Autonomous agent keeps its current tools (no build); it can be given these tools later if desired.

---

## 2. Architecture After Refactor

```
User / Cron
    → Obedient agent (single layer)
        Tools: chat, get_occupants, approach_position, approach_person, stop,
               list_catalog, list_documents, get_document_content,
               list_recipes, run_recipe, build_full, build_incremental, build_with_code,
               delete_document, delete_all_documents
    → executeTool(name, args)
        → TOOL_HANDLERS[name](ctx)
        → Handler runs (uses @doppelfun/recipes for list_recipes and run_recipe), returns { ok, summary } or { ok: false, error }
```

- No subagent, no `run_build`, no `buildSubagentContext`. The agent calls tools directly; each tool has a strict schema and a single result.

---

## 3. Part A: Rename gen → recipes

### 3.1 Package rename

- **Folder:** `doppel-sdk/packages/gen` → `doppel-sdk/packages/recipes`.
- **Package name:** `@doppelfun/gen` → `@doppelfun/recipes` in `package.json` (name, exports).
- **Imports:** Update all imports from `@doppelfun/gen` to `@doppelfun/recipes` (in claw and anywhere else that references gen). Claw’s `package.json` dependency: `"@doppelfun/recipes": "workspace:*"`.
- **Exports:** Keep the same public API (e.g. `runProceduralMml`, `listProceduralKinds`, city/pyramid/grass/trees exports). The recipes package is used by claw’s `list_recipes` tool (e.g. via `listProceduralKinds()`) and `run_recipe` tool (via `runProceduralMml()`).

### 3.2 Files to touch

- Rename/move `packages/gen` → `packages/recipes`.
- Update `packages/recipes/package.json` name and any internal path references.
- In claw: replace `@doppelfun/gen` with `@doppelfun/recipes` (proceduralHandler, any catalog or build code that imports gen).
- In doppel-sdk root or workspace: ensure recipes is listed in workspace packages if applicable.

---

## 4. Part B: Remove Build Subagent and Expose Build Tools on Obedient Agent

### 4.1 Build and recipe tools (strict input/output)

These become normal claw tools, registered in `CLAW_TOOL_REGISTRY` and `TOOL_HANDLERS`:

| Tool | Input (Zod) | Output |
|------|-------------|--------|
| `list_catalog` | `listCatalogSchema` (limit optional) | `{ ok: true, summary }` with catalog entries text |
| `list_documents` | `listDocumentsSchema` ({}) | `{ ok: true, summary }` with document IDs |
| `get_document_content` | `getDocumentContentSchema` (documentId?, target?) | `{ ok: true, summary }` with MML or error |
| `list_recipes` | `listRecipesSchema` ({}) | `{ ok: true, summary }` with recipe names and short descriptions (from @doppelfun/recipes, e.g. `listProceduralKinds()`) |
| `run_recipe` | `runRecipeSchema` (kind, documentMode?, documentId?, params?) | `{ ok: true, summary }` or `{ ok: false, error }` (uses @doppelfun/recipes `runProceduralMml`; same as current generate_procedural) |
| `build_full` | `buildFullSchema` (instruction, documentTarget?, documentId?) | `{ ok: true, summary }` or `{ ok: false, error }` |
| `build_incremental` | `buildIncrementalSchema` (instruction, documentTarget?, documentId?, position?) | same |
| `build_with_code` | `buildFullSchema` (same as build_full) | same |
| `delete_document` | `deleteDocumentSchema` (documentId?, target?) | same |
| `delete_all_documents` | `deleteAllDocumentsSchema` ({}) | same |

- **list_recipes:** New tool. No args (or empty schema). Handler calls the recipes package (e.g. `listProceduralKinds()`) and returns a summary string listing recipe names (e.g. city, pyramid, grass, trees) for the agent to use before calling `run_recipe`.
- **run_recipe:** Rename of `generate_procedural`. Use the same schema as current `generateProceduralSchema` (kind, documentMode?, documentId?, params?). Handler is the same logic (calls `runProceduralMml` from @doppelfun/recipes); only the tool name changes.

Schemas for the existing build tools are in `buildToolsZod.ts` (rename `generateProceduralSchema` to `runRecipeSchema` for the new tool name; add `listRecipesSchema` as an empty object). Handlers exist in the build subagent; the procedural handler is wired to `run_recipe` instead of `generate_procedural`.

### 4.2 Implementation steps

1. **Move schemas into the main tool registry**
   - In `toolsZod.ts` (or a new `tools/buildZod.ts` that you re-export), add the ten build/recipe tool entries to `CLAW_TOOL_REGISTRY`: name, description, schema. Reuse the schemas from the current build subagent; add `listRecipesSchema` (e.g. `z.object({})`) for `list_recipes`; use the existing procedural schema as `runRecipeSchema` for `run_recipe` (no schema rename in the package required, just the tool name).

2. **Wire build and recipe handlers into TOOL_HANDLERS**
   - Build handlers currently take `(client, store, config, args)`. The claw `ToolHandler` signature is `(ctx: ToolContext) => Promise<ExecuteToolResult>`. Add thin wrappers that call the existing handlers with `ctx.client`, `ctx.store`, `ctx.config`, `ctx.args` and return the result.
   - **list_recipes:** New handler that calls the recipes package (e.g. `listProceduralKinds()`) and returns a summary string (e.g. "Recipes: city, pyramid, grass, trees" or a short description per kind).
   - **run_recipe:** Wire the existing `handleGenerateProcedural` handler to the tool name `run_recipe` (same logic, new tool name).
   - Register in `tools/handlers/index.ts`: `list_catalog`, `list_documents`, `get_document_content`, `list_recipes`, `run_recipe`, `build_full`, `build_incremental`, `build_with_code`, `delete_document`, `delete_all_documents`. Handlers can live in `tools/handlers/build.ts` (or split by concern) and import the existing build handler functions from the build subagent folder **until** that folder is removed (then move handler implementations into tools/handlers).

3. **Remove the build subagent**
   - Delete or stop using: `createRunBuildTool`, `createBuildSubagent`, `buildSubagent.ts`, `buildToolSet.ts`, `runBuildTool.ts`. Move any handler logic that’s still needed into `tools/handlers/` (e.g. under `tools/handlers/build/` or `tools/handlers/catalog.ts`, `documents.ts`, `procedural.ts`, `buildLlm.ts`) so `TOOL_HANDLERS` has everything it needs.
   - Remove `buildSubagentContext` from state and store (`state.ts`, `store.ts`: remove field and methods like `appendBuildSubagentExchange`, `clearBuildSubagentContext`).
   - Remove the `subagents/build` directory once handlers are moved and wired.

4. **Obedient agent: add build/recipe tools, remove run_build**
   - In `obedientAgent.ts`: Expand `OBEDIENT_TOOL_NAMES` to include the ten build/recipe tools (`list_catalog`, `list_documents`, `get_document_content`, `list_recipes`, `run_recipe`, `build_full`, `build_incremental`, `build_with_code`, `delete_document`, `delete_all_documents`). Remove `run_build` and `createRunBuildTool`. Use `buildClawToolSet(client, store, config, { allowOnlyTools: OBEDIENT_TOOL_NAMES, onToolResult })` with no special-case tool; all tools come from the registry.
   - Update `OBEDIENT_INSTRUCTIONS`: Replace “call run_build with the owner’s request” with instructions that describe the direct tools (e.g. use list_recipes to see available recipes; for premade scenes use run_recipe with kind city/pyramid/grass/trees; for custom use build_full or build_incremental; list_catalog, list_documents, get_document_content, delete_* as needed). Only the owner can ask to build.
   - Update `stopWhen`: Remove `hasToolCall("run_build")`. Add stop conditions for the build/recipe tools (e.g. `hasToolCall("list_recipes")`, `hasToolCall("run_recipe")`, `hasToolCall("build_full")`, `hasToolCall("build_incremental")`, `hasToolCall("build_with_code")`, `hasToolCall("delete_document")`, `hasToolCall("delete_all_documents")`) so the agent stops after a build action.

5. **Autonomous agent**
   - Leave as-is: no build tools, no `run_build`. Optional later: add the same build tools or a subset.

---

## 5. File and Module Summary

| Area | Action |
|------|--------|
| **packages/gen** | Rename to **packages/recipes**; update package name to `@doppelfun/recipes`. |
| **claw dependency** | Change `@doppelfun/gen` → `@doppelfun/recipes`; update all imports. |
| **toolsZod.ts** | Add ten build/recipe tool entries to CLAW_TOOL_REGISTRY: list_catalog, list_documents, get_document_content, list_recipes, run_recipe, build_full, build_incremental, build_with_code, delete_document, delete_all_documents (schemas from buildToolsZod + listRecipesSchema, runRecipeSchema). |
| **tools/handlers/** | Add handlers for list_catalog, list_documents, get_document_content, list_recipes, run_recipe (list_recipes new; run_recipe = generate_procedural logic), build_full, build_incremental, build_with_code, delete_document, delete_all_documents (wrap or move existing build handlers); register in TOOL_HANDLERS. |
| **agent/subagents/build/** | Remove after moving handlers; delete runBuildTool, buildSubagent, buildToolSet, buildHandlers (logic moved to tools/handlers). |
| **obedientAgent.ts** | Add build tool names to OBEDIENT_TOOL_NAMES; remove run_build and createRunBuildTool; update instructions and stopWhen. |
| **state/store** | Remove buildSubagentContext and related methods. |
| **Other** | Remove any remaining references to run_build, createBuildSubagent, buildSubagentContext (e.g. systemPrompt, tests). |

---

## 6. Implementation Order

1. **Rename gen → recipes**  
   Rename package folder and name; update claw (and any other) imports to `@doppelfun/recipes`. Verify build still works (generate_procedural uses recipes).

2. **Add build and recipe tools to claw tool layer**  
   Add the ten tools (including list_recipes and run_recipe) to CLAW_TOOL_REGISTRY (schemas) and TOOL_HANDLERS (wrappers around existing build handlers; new list_recipes handler). Ensure executeTool can dispatch to them.

3. **Obedient agent: use build tools, drop run_build**  
   Extend OBEDIENT_TOOL_NAMES with the build tools; remove run_build and createRunBuildTool; update instructions and stopWhen.

4. **Remove build subagent and state**  
   Delete build subagent directory and run_build/buildSubagent code; remove buildSubagentContext from state and store; move any remaining handler logic into tools/handlers if not already there.

5. **Cleanup and tests**  
   Remove dead references; update or add tests for Obedient agent with build/recipe tools; ensure list_recipes, run_recipe, and other build tools are covered.

---

## 7. Out of Scope (for later)

- Adding build/recipe tools to the Autonomous agent.
- A separate “recipe registry” beyond list_recipes + run_recipe (this plan uses list_recipes and run_recipe backed by the recipes package procedural API).
- Cron or task extensions.
- Marketplace or DB-backed scripts.
