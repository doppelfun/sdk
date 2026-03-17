/**
 * Build handler: list_catalog, generate_catalog_model.
 * Catalog is used by build_full / build_incremental to pick catalogId for <m-model>.
 */
import type { DoppelClient } from "@doppelfun/sdk";
import { generateCatalogModel } from "@doppelfun/sdk";
import type { ClawStore } from "../../state/index.js";
import type { ClawConfig } from "../../config/index.js";
import { loadCatalogEntries } from "../catalog.js";
import { clawLog } from "../../../util/log.js";
import type { BuildToolResult } from "../buildSteps.js";

const COMPACT_MAX_CHARS = 2800;
const COMPACT_MAX_ENTRIES = 35;
const MAX_SUMMARY = 8000;

/**
 * List catalog entries (id, name, url, category) for MML <m-model catalogId="...">.
 * Caches compact JSON in store.lastCatalogContext for the subagent.
 *
 * @param _client - Unused
 * @param store - Claw store (setLastCatalogContext)
 * @param config - Claw config (blockId, engineUrl for source label)
 * @param args - Optional limit (default 100, max 200)
 * @returns BuildToolResult with summary (JSON of entries)
 */
export async function handleListCatalog(
  _client: DoppelClient,
  store: ClawStore,
  config: ClawConfig,
  args: { limit?: number }
): Promise<BuildToolResult> {
  clawLog("build: list_catalog", "limit=" + (args.limit ?? 100));
  try {
    const catalog = await loadCatalogEntries(config);
    const limit =
      typeof args.limit === "number" && args.limit > 0
        ? Math.min(200, Math.floor(args.limit))
        : 100;
    const slice = catalog.slice(0, limit);
    const source = config.blockId ? `hub block ${config.blockId}` : `engine ${config.engineUrl}`;
    const json = JSON.stringify(slice, null, 0);
    const prefix = `${catalog.length} catalog entries (${source}); showing ${slice.length}. Use catalog id in build MML <m-model catalogId="...">. JSON: `;
    let body = json;
    if (prefix.length + body.length > MAX_SUMMARY) {
      body = body.slice(0, Math.max(0, MAX_SUMMARY - prefix.length - 30)) + "… (truncated)";
    }
    const summary = prefix + body;
    const compactEntries = slice.slice(0, COMPACT_MAX_ENTRIES).map((e) => ({
      id: e.id,
      ...(e.name ? { name: e.name } : {}),
      ...(e.category ? { category: e.category } : {}),
    }));
    let compact =
      `${catalog.length} catalog entries (${source}); showing ${compactEntries.length}. JSON: ` +
      JSON.stringify(compactEntries);
    if (compact.length > COMPACT_MAX_CHARS) compact = compact.slice(0, COMPACT_MAX_CHARS) + "…";
    store.setLastCatalogContext(compact);
    clawLog("build: list_catalog ok", catalog.length, "entries");
    return { ok: true, summary };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    clawLog("build: list_catalog error", err);
    return { ok: false, error: `list_catalog failed: ${err}` };
  }
}

/**
 * Start text-to-3D generation for the block's catalog via hub POST .../catalog/generate.
 * Requires config.blockId and config.apiKey. Returns jobId/catalogId for polling or list_catalog.
 */
export async function handleGenerateCatalogModel(
  _client: DoppelClient,
  _store: ClawStore,
  config: ClawConfig,
  args: { prompt: string; name?: string; category?: string }
): Promise<BuildToolResult> {
  if (!config.blockId?.trim()) {
    return { ok: false, error: "generate_catalog_model requires a block (set BLOCK_ID or join a block)" };
  }
  if (!config.apiKey?.trim()) {
    return { ok: false, error: "generate_catalog_model requires an API key (DOPPEL_AGENT_API_KEY)" };
  }
  const prompt = typeof args.prompt === "string" ? args.prompt.trim() : "";
  if (!prompt) {
    return { ok: false, error: "generate_catalog_model requires a non-empty prompt" };
  }

  clawLog("build: generate_catalog_model", "prompt=" + prompt.slice(0, 60) + (prompt.length > 60 ? "…" : ""));
  try {
    const result = await generateCatalogModel(config.hubUrl, config.blockId, config.apiKey, {
      prompt,
      name: args.name?.trim(),
      category: args.category?.trim(),
    });

    if (result.ok) {
      const summary =
        `Text-to-3D started. jobId=${result.jobId}, catalogId=${result.catalogId}. ` +
        "Poll GET /api/jobs/:jobId or use list_catalog until the model is ready, then use this catalogId in build_full or run_recipe.";
      clawLog("build: generate_catalog_model ok", result.jobId);
      return { ok: true, summary };
    }

    const msg =
      result.statusCode === 402 && result.code === "insufficient_credits"
        ? `Insufficient credits (balance: ${result.balance ?? "?"}, required: ${result.required ?? "?"}). Top up credits and try again.`
        : result.error;
    return { ok: false, error: msg };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    clawLog("build: generate_catalog_model error", err);
    return { ok: false, error: `generate_catalog_model failed: ${err}` };
  }
}
