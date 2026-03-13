/**
 * Catalog loading for list_catalog and build tools (hub or engine).
 */

import { getBlockCatalog, getEngineCatalog, type CatalogEntry as SdkCatalogEntry } from "@doppelfun/sdk";
import type { ClawConfig } from "../../config/config.js";

export type CatalogEntry = { id: string; name?: string; url?: string; category?: string };

export function mapSdkCatalog(list: SdkCatalogEntry[]): CatalogEntry[] {
  return list
    .map((e: SdkCatalogEntry) => ({
      id: e.id || e.tag || "",
      name: e.name,
      url: e.url,
      category: e.category,
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
