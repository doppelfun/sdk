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
};

type SdkEntry = { id?: string; tag?: string; name?: string; url?: string; category?: string; width?: number | null; depth?: number | null; height?: number | null };

function mapEntry(e: SdkEntry): CatalogEntry {
  return {
    id: e.id ?? e.tag ?? "",
    name: e.name,
    url: e.url,
    category: e.category,
    width: e.width,
    depth: e.depth,
    height: e.height,
  };
}

export async function loadCatalogEntries(config: ClawConfig): Promise<CatalogEntry[]> {
  if (config.blockId) {
    const list = await getBlockCatalog(config.hubUrl, config.blockId, config.apiKey);
    return list.map((e) => mapEntry(e as SdkEntry)).filter((e) => e.id);
  }
  const list = await getEngineCatalog(config.engineUrl);
  return list.map((e) => mapEntry(e as SdkEntry)).filter((e) => e.id);
}

/** Same as loadCatalogEntries but returns [] on failure so build can still run. */
export async function getCatalogForBuild(config: ClawConfig): Promise<CatalogEntry[]> {
  try {
    return await loadCatalogEntries(config);
  } catch {
    return [];
  }
}

export function catalogToJson(catalog: CatalogEntry[]): string {
  return JSON.stringify(catalog.slice(0, 100), null, 0);
}
