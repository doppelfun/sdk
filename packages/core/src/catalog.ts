/**
 * Hub + engine catalog HTTP clients.
 *
 * All lists are DB-backed only (no static asset merge):
 * - Hub GET /api/blocks/:id/catalog — full entries; engine caches this.
 * - Hub GET /api/catalog?blockId=&type=&category= — public list shape.
 * - Engine GET /api/catalog — proxy of hub cache (empty if hub down and no cache).
 */

import { fetchJson, normalizeBaseUrl } from "./utils.js";

/** Full entry (hub block catalog / engine cache). */
export type CatalogEntry = {
  id: string;
  name: string;
  url: string;
  category: string;
  assetType?: string;
  triangleCount?: number;
  blockId?: string | null;
  /** Hub may send tag as id alias */
  tag?: string;
};

/** Public list entry (hub GET /api/catalog). */
export type CatalogPublicEntry = {
  tag: string;
  name: string;
  category: string;
  assetType?: string;
  type?: string;
  url: string;
};

export type ListCatalogParams = {
  type?: string;
  category?: string;
  blockId?: string;
};

function bearerHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

/** GET /api/blocks/:blockId/catalog — optional Bearer for creator-scoped rows when hub uses visibility (blockOnly still returns globals + block). */
export async function getBlockCatalog(
  hubUrl: string,
  blockId: string,
  apiKey?: string
): Promise<CatalogEntry[]> {
  const base = normalizeBaseUrl(hubUrl);
  const url = `${base}/api/blocks/${encodeURIComponent(blockId)}/catalog`;
  const headers: HeadersInit = apiKey
    ? bearerHeaders(apiKey)
    : { "Content-Type": "application/json" };
  const data = await fetchJson<{ catalog?: CatalogEntry[] }>(
    url,
    { method: "GET", headers },
    "GET /api/blocks/:id/catalog"
  );
  const list = data.catalog;
  if (!Array.isArray(list)) return [];
  return list.map(normalizeCatalogEntry);
}

/** GET /api/catalog?... — public shape; pass blockId to match block catalog slice. */
export async function listCatalog(
  hubUrl: string,
  params: ListCatalogParams = {},
  apiKey?: string
): Promise<CatalogPublicEntry[]> {
  const base = normalizeBaseUrl(hubUrl);
  const search = new URLSearchParams();
  if (params.type) search.set("type", params.type);
  if (params.category) search.set("category", params.category);
  if (params.blockId) search.set("blockId", params.blockId);
  const q = search.toString();
  const url = q ? `${base}/api/catalog?${q}` : `${base}/api/catalog`;
  const headers: HeadersInit = apiKey
    ? bearerHeaders(apiKey)
    : { "Content-Type": "application/json" };
  const data = await fetchJson<{ catalog?: CatalogPublicEntry[] }>(
    url,
    { method: "GET", headers },
    "GET /api/catalog"
  );
  return Array.isArray(data.catalog) ? data.catalog : [];
}

/** GET {engineUrl}/api/catalog — whatever the block server cached from hub (may be []). */
export async function getEngineCatalog(engineUrl: string): Promise<CatalogEntry[]> {
  const base = normalizeBaseUrl(engineUrl);
  const data = await fetchJson<{ catalog?: CatalogEntry[] }>(
    `${base}/api/catalog`,
    { method: "GET", headers: { "Content-Type": "application/json" } },
    "GET {engine}/api/catalog"
  );
  const list = data.catalog;
  if (!Array.isArray(list)) return [];
  return list.map(normalizeCatalogEntry);
}

/** Ensure .id is set (hub may send tag only). */
export function normalizeCatalogEntry(entry: CatalogEntry): CatalogEntry {
  const id = entry.id || entry.tag;
  if (!id) return entry;
  return { ...entry, id };
}

/** MML catalogId resolution: prefer id then tag. */
export function catalogEntryId(entry: CatalogEntry | CatalogPublicEntry): string {
  if ("id" in entry && entry.id) return entry.id;
  if ("tag" in entry && entry.tag) return entry.tag;
  return "";
}
