/**
 * Build handler: list_catalog, place_catalog_model.
 * Catalog is used by build_full / build_incremental to pick catalogId for <m-model>.
 */
import type { DoppelClient } from "@doppelfun/sdk";
import type { ClawStore } from "../../state/index.js";
import type { ClawConfig } from "../../config/index.js";
import { loadCatalogEntries } from "../catalog.js";
import { clawLog } from "../../../util/log.js";
import type { BuildToolResult } from "../buildSteps.js";

/** Format number for MML (2 decimal places). */
function r2(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) : "0";
}

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
 * Place a catalog model at block-local coordinates. Creates a new document with a single
 * m-model, or appends to an existing document by inserting the m-model before the last </m-group>.
 */
export async function handlePlaceCatalogModel(
  client: DoppelClient,
  _store: ClawStore,
  _config: ClawConfig,
  args: {
    catalogId: string;
    x: number;
    y: number;
    z: number;
    documentId?: string;
    ry?: number;
    id?: string;
  }
): Promise<BuildToolResult> {
  const catalogId = typeof args.catalogId === "string" ? args.catalogId.trim() : "";
  if (!catalogId) {
    return { ok: false, error: "place_catalog_model requires catalogId (use list_catalog for ids)" };
  }
  const x = Number(args.x);
  const y = Number(args.y);
  const z = Number(args.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return { ok: false, error: "place_catalog_model requires numeric x, y, z (block-local 0–100)" };
  }
  const ry = typeof args.ry === "number" && Number.isFinite(args.ry) ? args.ry : 0;
  const modelId =
    typeof args.id === "string" && args.id.trim()
      ? args.id.trim()
      : `placed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const attrs = [
    `id="${modelId}"`,
    `x="${r2(x)}"`,
    `y="${r2(y)}"`,
    `z="${r2(z)}"`,
    `catalogId="${catalogId}"`,
    `ry="${r2(ry)}"`,
    "collide=\"true\"",
  ];
  const mModelLine = `  <m-model ${attrs.join(" ")} />`;

  clawLog("build: place_catalog_model", catalogId, x, y, z, args.documentId ? "append" : "new");

  try {
    if (args.documentId?.trim()) {
      const doc = await client.getDocumentContent(args.documentId.trim());
      const lastClose = doc.content.lastIndexOf("</m-group>");
      if (lastClose === -1) {
        return { ok: false, error: "place_catalog_model append: document has no </m-group>, use new document" };
      }
      const before = doc.content.slice(0, lastClose);
      const after = doc.content.slice(lastClose);
      const newContent = `${before}\n${mModelLine}\n${after}`;
      await client.updateDocument(doc.documentId, newContent);
      clawLog("build: place_catalog_model ok", "appended to", doc.documentId);
      return { ok: true, summary: `Placed ${catalogId} at (${x},${y},${z}) in document ${doc.documentId}` };
    }
    const content = `<m-group id="place-root">\n${mModelLine}\n</m-group>`;
    const { documentId } = await client.createDocument(content);
    clawLog("build: place_catalog_model ok", "new document", documentId);
    return { ok: true, summary: `Placed ${catalogId} at (${x},${y},${z}); new document ${documentId}` };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    clawLog("build: place_catalog_model error", err);
    return { ok: false, error: `place_catalog_model failed: ${err}` };
  }
}
