/**
 * Catalog loading for list_catalog and build tools (hub or engine).
 */
import { getBlockCatalog, getEngineCatalog } from "@doppelfun/sdk";
import type { ClawConfig } from "../config/index.js";

export type CatalogEntry = {
  id: string;
  name?: string;
  url?: string;
  category?: string;
  width?: number | null;
  depth?: number | null;
  height?: number | null;
  triangleCount?: number;
};

type SdkEntry = {
  id?: string;
  tag?: string;
  name?: string;
  url?: string;
  category?: string;
  width?: number | null;
  depth?: number | null;
  height?: number | null;
  triangleCount?: number;
};

function mapEntry(e: SdkEntry): CatalogEntry {
  return {
    id: e.id ?? e.tag ?? "",
    name: e.name,
    url: e.url,
    category: e.category,
    width: e.width,
    depth: e.depth,
    height: e.height,
    triangleCount: e.triangleCount,
  };
}

/**
 * Load catalog entries from hub (when blockId set) or engine. Used by list_catalog and build tools.
 *
 * @param config - Claw config (hubUrl, blockId, apiKey, engineUrl)
 * @returns Catalog entries for MML <m-model catalogId="...">
 */
export async function loadCatalogEntries(config: ClawConfig): Promise<CatalogEntry[]> {
  if (config.blockId) {
    const list = await getBlockCatalog(config.hubUrl, config.blockId, config.apiKey);
    return list.map((e) => mapEntry(e as SdkEntry)).filter((e) => e.id);
  }
  const list = await getEngineCatalog(config.engineUrl);
  return list.map((e) => mapEntry(e as SdkEntry)).filter((e) => e.id);
}

/**
 * Load catalog for build tools. Returns [] on failure so build_full can still run without catalog.
 *
 * @param config - Claw config
 * @returns Catalog entries or []
 */
export async function getCatalogForBuild(config: ClawConfig): Promise<CatalogEntry[]> {
  try {
    return await loadCatalogEntries(config);
  } catch {
    return [];
  }
}

/** Serialize catalog (first 100 entries) for LLM prompt. */
export function catalogToJson(catalog: CatalogEntry[]): string {
  return JSON.stringify(catalog.slice(0, 100), null, 0);
}
