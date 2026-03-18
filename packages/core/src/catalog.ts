/**
 * Hub + engine catalog HTTP clients.
 *
 * All lists are DB-backed only (no static asset merge):
 * - Hub GET /api/blocks/:id/catalog — full entries; engine caches this.
 * - Hub GET /api/catalog?blockId=&type=&category= — public list shape.
 * - Engine GET /api/catalog — proxy of hub cache (empty if hub down and no cache).
 *
 * Mutations are block-scoped (blockId in path only):
 * - POST /api/blocks/:id/catalog — JSON create
 * - POST /api/blocks/:id/catalog/upload-model — GLB (multipart)
 * - POST /api/blocks/:id/catalog/upload-audio — audio (multipart)
 * - POST /api/blocks/:id/catalog/generate — image/text-to-3D (JSON or multipart)
 * - PATCH/DELETE GET .../blocks/:id/catalog/:catalogId — by asset id
 * - GET .../blocks/:id/catalog/:catalogId/jobs — jobs for asset
 * Legacy POST /api/catalog/upload etc. return 410 Gone.
 */

import { fetchJson, normalizeBaseUrl } from "./utils.js";

/** Full entry (hub block catalog / engine cache). Includes collision and dimensions for models. */
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
  /** URL to collision mesh blob (models). */
  collisionUrl?: string | null;
  /** Bounding box dimensions in meters (models). For recipe generation and pathfinding. */
  width?: number | null;
  depth?: number | null;
  height?: number | null;
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

/**
 * Base URLs for block-scoped catalog mutations. Use with fetch + Bearer apiKey.
 * Multipart uploads: POST uploadModel/uploadAudio with FormData field "file".
 */
export function blockCatalogMutationUrls(hubUrl: string, blockId: string) {
  const base = normalizeBaseUrl(hubUrl);
  const b = encodeURIComponent(blockId);
  const prefix = `${base}/api/blocks/${b}/catalog`;
  return {
    /** GET list / POST JSON create */
    catalog: prefix,
    /** POST multipart GLB */
    uploadModel: `${prefix}/upload-model`,
    /** POST multipart audio */
    uploadAudio: `${prefix}/upload-audio`,
    /** POST JSON or multipart image; x402 when configured */
    generate: `${prefix}/generate`,
    /** GET/PATCH/DELETE one block-scoped asset */
    asset: (catalogId: string) =>
      `${prefix}/${encodeURIComponent(catalogId)}`,
    /** GET jobs for asset */
    jobs: (catalogId: string) =>
      `${prefix}/${encodeURIComponent(catalogId)}/jobs`,
  };
}

/** MML catalogId resolution: prefer id then tag. */
export function catalogEntryId(entry: CatalogEntry | CatalogPublicEntry): string {
  if ("id" in entry && entry.id) return entry.id;
  if ("tag" in entry && entry.tag) return entry.tag;
  return "";
}

export type GenerateCatalogModelSuccess = {
  ok: true;
  jobId: string;
  catalogId: string;
  status: string;
  message?: string;
};

export type GenerateCatalogModelError = {
  ok: false;
  statusCode: number;
  error: string;
  code?: string;
  balance?: number;
  required?: number;
};

/**
 * Start text-to-3D (or image-to-3D) generation for the block's catalog.
 * POST /api/blocks/:blockId/catalog/generate. Requires catalog auth (Bearer apiKey).
 * paymentType: "credits" (default) or "x402". On 402 (insufficient credits or x402), returns ok: false.
 */
export async function generateCatalogModel(
  hubUrl: string,
  blockId: string,
  apiKey: string,
  params: {
    prompt: string;
    name?: string;
    category?: string;
    /** "credits" (default) or "x402" */
    paymentType?: "credits" | "x402";
  }
): Promise<GenerateCatalogModelSuccess | GenerateCatalogModelError> {
  const base = normalizeBaseUrl(hubUrl);
  const url = `${base}/api/blocks/${encodeURIComponent(blockId)}/catalog/generate`;
  const paymentType = params.paymentType ?? "credits";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: params.prompt.trim(),
      paymentType,
      ...(params.name?.trim() && { name: params.name.trim() }),
      ...(params.category?.trim() && { category: params.category.trim() }),
    }),
  });

  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // non-JSON response
  }

  if (res.ok) {
    const jobId = typeof data.jobId === "string" ? data.jobId : "";
    const catalogId = typeof data.catalogId === "string" ? data.catalogId : "";
    const status = typeof data.status === "string" ? data.status : "model_generating";
    const message = typeof data.message === "string" ? data.message : undefined;
    if (!jobId || !catalogId) {
      return {
        ok: false,
        statusCode: res.status,
        error: (data.error as string) || "Missing jobId or catalogId in response",
      };
    }
    return { ok: true, jobId, catalogId, status, message };
  }

  const error = typeof data.error === "string" ? data.error : `Request failed: ${res.status}`;
  return {
    ok: false,
    statusCode: res.status,
    error,
    code: typeof data.code === "string" ? data.code : undefined,
    balance: typeof data.balance === "number" ? data.balance : undefined,
    required: typeof data.required === "number" ? data.required : undefined,
  };
}
