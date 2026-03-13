/**
 * Hub API — aligned with doppel-app routes (blocks, agents/me, credits, report-usage).
 * All requests use Bearer agent API key unless noted.
 */

export type JoinBlockResult =
  | { ok: true; jwt: string; serverUrl: string; blockId: string; blockSlotId: string }
  | { ok: false; error: string; status?: number };

export type CreateBlockResult =
  | { ok: true; blockId: string; serverUrl: string | null; name: string }
  | { ok: false; error: string; status?: number };

export type AgentProfile = {
  id: string;
  name: string;
  hosted: boolean;
  accountId: string | null;
};

/** Result of POST /api/agents/me/report-usage */
export type ReportUsageResult =
  | { ok: true; balanceAfter?: number }
  | { ok: false; error: string; status?: number };

export type CheckBalanceResult =
  | { ok: true; balance: number; linked: boolean }
  | { ok: false; error: string; status?: number };

import { normalizeUrl } from "../../util/url.js";

async function hubGet(
  url: string,
  apiKey: string
): Promise<{ ok: true; text: string } | { ok: false; error: string; status: number }> {
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, error: text || `HTTP ${res.status}`, status: res.status };
  return { ok: true, text };
}

async function hubPost(
  url: string,
  apiKey: string,
  body?: Record<string, unknown>
): Promise<{ ok: true; text: string } | { ok: false; error: string; status: number }> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    ...(body != null && { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, error: text || `HTTP ${res.status}`, status: res.status };
  return { ok: true, text };
}

/**
 * POST /api/blocks/:id/join — JWT + blockId + regionId (block slot).
 */
export async function joinBlock(
  hubUrl: string,
  apiKey: string,
  blockId: string
): Promise<JoinBlockResult> {
  const base = normalizeUrl(hubUrl);
  const res = await hubPost(`${base}/api/blocks/${encodeURIComponent(blockId)}/join`, apiKey);
  if (!res.ok) return res;
  let data: { jwt?: string; serverUrl?: string; blockId?: string; regionId?: string };
  try {
    data = JSON.parse(res.text) as {
      jwt?: string;
      serverUrl?: string;
      blockId?: string;
      regionId?: string;
    };
  } catch {
    return { ok: false, error: "Invalid JSON from hub" };
  }
  const jwt = data.jwt;
  if (!jwt || typeof jwt !== "string") return { ok: false, error: "Hub response missing jwt" };
  const blockSlotId =
    (typeof data.regionId === "string" && data.regionId.trim()) || "0_0";
  const serverUrl =
    typeof data.serverUrl === "string" && data.serverUrl.trim() !== ""
      ? data.serverUrl.trim()
      : "";
  return {
    ok: true,
    jwt,
    serverUrl,
    blockId: typeof data.blockId === "string" ? data.blockId : blockId,
    blockSlotId,
  };
}

/** POST /api/blocks */
export async function createBlock(
  hubUrl: string,
  apiKey: string,
  options: { name: string; description?: string; maxConnections?: number }
): Promise<CreateBlockResult> {
  const base = normalizeUrl(hubUrl);
  const body: Record<string, unknown> = {
    name: options.name,
    description: options.description ?? null,
    maxConnections: options.maxConnections ?? 250,
  };
  const res = await hubPost(`${base}/api/blocks`, apiKey, body);
  if (!res.ok) return res;
  let data: { id?: string; blockId?: string; serverUrl?: string | null; name?: string };
  try {
    data = JSON.parse(res.text) as { id?: string; blockId?: string; serverUrl?: string | null; name?: string };
  } catch {
    return { ok: false, error: "Invalid JSON from hub" };
  }
  const id = data.id ?? data.blockId;
  if (!id || typeof id !== "string") return { ok: false, error: "Hub response missing id/blockId" };
  return {
    ok: true,
    blockId: id,
    serverUrl: typeof data.serverUrl === "string" ? data.serverUrl : null,
    name: typeof data.name === "string" ? data.name : options.name,
  };
}

/** GET /api/agents/me */
export async function getAgentProfile(
  hubUrl: string,
  apiKey: string
): Promise<{ ok: true; profile: AgentProfile } | { ok: false; error: string }> {
  const base = normalizeUrl(hubUrl);
  const res = await hubGet(`${base}/api/agents/me`, apiKey);
  if (!res.ok) return res;
  let data: AgentProfile;
  try {
    data = JSON.parse(res.text) as AgentProfile;
  } catch {
    return { ok: false, error: "Invalid JSON from hub" };
  }
  return { ok: true, profile: data };
}

/**
 * POST /api/agents/me/report-usage.
 * - OpenRouter: pass model + tokens; hub looks up OpenRouter pricing.
 * - Google/Vertex: pass costUsd (base before markup) + tokens; hub skips pricing lookup.
 */
export async function reportUsage(
  hubUrl: string,
  apiKey: string,
  options: {
    promptTokens: number;
    completionTokens: number;
    /** OpenRouter model id — required when costUsd omitted. */
    model?: string;
    /** Precomputed base USD (before markup). When set, hub does not call OpenRouter pricing. */
    costUsd?: number;
  }
): Promise<ReportUsageResult> {
  const base = normalizeUrl(hubUrl);
  const body: Record<string, unknown> = {
    promptTokens: options.promptTokens,
    completionTokens: options.completionTokens,
  };
  if (options.costUsd != null && Number.isFinite(options.costUsd) && options.costUsd >= 0) {
    body.costUsd = options.costUsd;
    body.model = options.model ?? "google"; // audit label only when costUsd supplied
  } else {
    if (!options.model) return { ok: false, error: "reportUsage: model required when costUsd omitted" };
    body.model = options.model;
  }
  const res = await hubPost(`${base}/api/agents/me/report-usage`, apiKey, body);
  if (!res.ok) return { ok: false, error: res.error, status: res.status };
  try {
    const data = JSON.parse(res.text) as { balanceAfter?: number };
    return { ok: true, balanceAfter: data.balanceAfter };
  } catch {
    return { ok: true };
  }
}

/**
 * GET /api/agents/me/credits — { balance }.
 * 400 = agent has no linked account → linked false.
 */
export async function checkBalance(
  hubUrl: string,
  apiKey: string
): Promise<CheckBalanceResult> {
  const base = normalizeUrl(hubUrl);
  const res = await hubGet(`${base}/api/agents/me/credits`, apiKey);
  if (!res.ok) {
    if (res.status === 400) {
      try {
        const data = JSON.parse(res.error) as { error?: string };
        if (data.error?.includes("no linked account")) {
          return { ok: true, balance: 0, linked: false };
        }
      } catch {
        /* fall through */
      }
    }
    return { ok: false, error: res.error, status: res.status };
  }
  let data: { balance?: number };
  try {
    data = JSON.parse(res.text) as { balance?: number };
  } catch {
    return { ok: false, error: "Invalid JSON from hub" };
  }
  return {
    ok: true,
    balance: typeof data.balance === "number" ? data.balance : 0,
    linked: true,
  };
}

/**
 * Hub API client — instance holds hubUrl + apiKey; use when you prefer methods over free functions.
 */
export class HubClient {
  constructor(
    readonly hubUrl: string,
    readonly apiKey: string
  ) {}

  joinBlock(blockId: string): Promise<JoinBlockResult> {
    return joinBlock(this.hubUrl, this.apiKey, blockId);
  }

  createBlock(options: { name: string; description?: string; maxConnections?: number }): Promise<CreateBlockResult> {
    return createBlock(this.hubUrl, this.apiKey, options);
  }

  getAgentProfile(): Promise<{ ok: true; profile: AgentProfile } | { ok: false; error: string }> {
    return getAgentProfile(this.hubUrl, this.apiKey);
  }

  reportUsage(options: {
    promptTokens: number;
    completionTokens: number;
    model?: string;
    costUsd?: number;
  }): Promise<ReportUsageResult> {
    return reportUsage(this.hubUrl, this.apiKey, options);
  }

  checkBalance(): Promise<CheckBalanceResult> {
    return checkBalance(this.hubUrl, this.apiKey);
  }
}
