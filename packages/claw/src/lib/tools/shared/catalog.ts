/**
 * Catalog loading for list_catalog and build tools (hub or engine).
 */

import { getBlockCatalog, getEngineCatalog, type CatalogEntry as SdkCatalogEntry } from "@doppelfun/sdk";
import type { ClawConfig } from "../../config/index.js";

export type CatalogEntry = {
  id: string;
  name?: string;
  url?: string;
  category?: string;
  /** From catalog API (models). Used for city layout when present. */
  width?: number | null;
  depth?: number | null;
  height?: number | null;
};

export function mapSdkCatalog(list: SdkCatalogEntry[]): CatalogEntry[] {
  return list
    .map((e: SdkCatalogEntry) => ({
      id: e.id || e.tag || "",
      name: e.name,
      url: e.url,
      category: e.category,
      width: e.width,
      depth: e.depth,
      height: e.height,
    }))
    .filter((e) => e.id);
}

export async function loadCatalogEntries(config: ClawConfig): Promise<CatalogEntry[]> {
  if (config.blockId) {
    const list = await getBlockCatalog(config.hubUrl, config.blockId, config.apiKey);
    return mapSdkCatalog(list);
  }
  const list = await getEngineCatalog(config.engineUrl);
  return mapSdkCatalog(list);
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
