import type { ToolContext } from "../types.js";
import { loadCatalogEntries, type CatalogEntry } from "../shared/catalog.js";

const COMPACT_MAX_CHARS = 2800;
const COMPACT_MAX_ENTRIES = 35;
const MAX_SUMMARY = 8000;

export async function handleListCatalog(ctx: ToolContext) {
  const { state, config, args, logAction } = ctx;
  let catalog: CatalogEntry[];
  try {
    catalog = await loadCatalogEntries(config);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `list_catalog failed: ${msg}` };
  }
  const limit =
    typeof args.limit === "number" && args.limit > 0
      ? Math.min(200, Math.floor(args.limit))
      : 100;
  const slice = catalog.slice(0, limit);
  const source = config.blockId ? `hub block ${config.blockId}` : `engine ${config.engineUrl}`;
  const json = JSON.stringify(slice, null, 0);
  const prefix = `${catalog.length} catalog entries (${source}); showing ${slice.length}. Use catalog id in build MML <m-model catalogId="..."> when available. JSON: `;
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
    `${catalog.length} catalog entries (${source}); showing ${compactEntries.length} compact (call list_catalog again for full list). JSON: ` +
    JSON.stringify(compactEntries);
  if (slice.length > COMPACT_MAX_ENTRIES) {
    compact += ` … (+${slice.length - COMPACT_MAX_ENTRIES} more in slice; +${catalog.length - slice.length} not in slice)`;
  }
  if (compact.length > COMPACT_MAX_CHARS) {
    compact = compact.slice(0, COMPACT_MAX_CHARS) + "… (truncated)";
  }
  state.lastCatalogContext = compact;
  logAction(summary);
  return { ok: true, summary };
}
