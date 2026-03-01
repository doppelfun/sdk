/**
 * Hub API: join space (get JWT + engine URL) and create space.
 * All requests use Bearer token auth; shared fetch + JSON parse.
 */

export type JoinSpaceResult =
  | { ok: true; jwt: string; serverUrl: string; spaceId: string; regionId?: string }
  | { ok: false; error: string; status?: number };

export type CreateSpaceResult =
  | { ok: true; spaceId: string; serverUrl: string | null; name: string }
  | { ok: false; error: string; status?: number };

export type AgentProfile = {
  id: string;
  name: string;
  hosted: boolean;
  accountId: string | null;
};

export type SpendCreditsResult =
  | { ok: true; balance: number; cost: number }
  | { ok: false; error: string; status?: number };

export type CheckBalanceResult =
  | { ok: true; balance: number; linked: boolean }
  | { ok: false; error: string; status?: number };

/** Normalize hub base URL (no trailing slash). */
function normalizeHubUrl(hubUrl: string): string {
  return hubUrl.replace(/\/$/, "");
}

/**
 * GET from a hub URL with Bearer apiKey. Returns raw text and status.
 */
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

/**
 * POST to a hub URL with Bearer apiKey. Returns raw text and status.
 * Caller parses JSON and maps to result type.
 */
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
 * Join a space. Returns JWT and engine serverUrl for that space.
 * Uses hub join endpoint; serverUrl may be hub fallback when space has no dedicated server.
 */
export async function joinSpace(
  hubUrl: string,
  apiKey: string,
  spaceId: string
): Promise<JoinSpaceResult> {
  const base = normalizeHubUrl(hubUrl);
  const res = await hubPost(`${base}/api/spaces/${encodeURIComponent(spaceId)}/join`, apiKey);
  if (!res.ok) return res;
  let data: { jwt?: string; serverUrl?: string; spaceId?: string; regionId?: string };
  try {
    data = JSON.parse(res.text) as { jwt?: string; serverUrl?: string; spaceId?: string; regionId?: string };
  } catch {
    return { ok: false, error: "Invalid JSON from hub" };
  }
  const jwt = data.jwt;
  if (!jwt || typeof jwt !== "string") return { ok: false, error: "Hub response missing jwt" };
  const regionId =
    typeof data.regionId === "string" && data.regionId.trim() ? data.regionId.trim() : "0_0";
  return {
    ok: true,
    jwt,
    serverUrl: typeof data.serverUrl === "string" ? data.serverUrl : base,
    spaceId: typeof data.spaceId === "string" ? data.spaceId : spaceId,
    regionId,
  };
}

/**
 * Create a new space. Returns space id, optional serverUrl (if deployed), and name.
 */
export async function createSpace(
  hubUrl: string,
  apiKey: string,
  options: { name: string; description?: string; maxAgents?: number }
): Promise<CreateSpaceResult> {
  const base = normalizeHubUrl(hubUrl);
  const body: Record<string, unknown> = {
    name: options.name,
    description: options.description ?? null,
    maxAgents: options.maxAgents ?? 100,
  };
  const res = await hubPost(`${base}/api/spaces`, apiKey, body);
  if (!res.ok) return res;
  let data: { id?: string; spaceId?: string; serverUrl?: string | null; name?: string };
  try {
    data = JSON.parse(res.text) as { id?: string; spaceId?: string; serverUrl?: string | null; name?: string };
  } catch {
    return { ok: false, error: "Invalid JSON from hub" };
  }
  const spaceId = data.id ?? data.spaceId;
  if (!spaceId || typeof spaceId !== "string") return { ok: false, error: "Hub response missing id/spaceId" };
  return {
    ok: true,
    spaceId,
    serverUrl: typeof data.serverUrl === "string" ? data.serverUrl : null,
    name: typeof data.name === "string" ? data.name : options.name,
  };
}

/**
 * Fetch the agent's own profile from the hub. Used at startup to check `hosted` flag.
 */
export async function getAgentProfile(
  hubUrl: string,
  apiKey: string
): Promise<{ ok: true; profile: AgentProfile } | { ok: false; error: string }> {
  const base = normalizeHubUrl(hubUrl);
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
 * Deduct credits from the agent's account. Fire-and-forget in chat ticks.
 */
export async function spendCredits(
  hubUrl: string,
  apiKey: string,
  amount: number,
  description: string
): Promise<SpendCreditsResult> {
  const base = normalizeHubUrl(hubUrl);
  const res = await hubPost(`${base}/api/agents/me/credits/spend`, apiKey, { amount, description });
  if (!res.ok) return res;
  let data: { balance?: number; cost?: number };
  try {
    data = JSON.parse(res.text) as { balance?: number; cost?: number };
  } catch {
    return { ok: false, error: "Invalid JSON from hub" };
  }
  return {
    ok: true,
    balance: typeof data.balance === "number" ? data.balance : 0,
    cost: typeof data.cost === "number" ? data.cost : amount,
  };
}

/**
 * Check the agent's credit balance. Used for pre-flight checks before expensive operations.
 */
export async function checkBalance(
  hubUrl: string,
  apiKey: string
): Promise<CheckBalanceResult> {
  const base = normalizeHubUrl(hubUrl);
  const res = await hubGet(`${base}/api/agents/me/credits/balance`, apiKey);
  if (!res.ok) return res;
  let data: { balance?: number; linked?: boolean };
  try {
    data = JSON.parse(res.text) as { balance?: number; linked?: boolean };
  } catch {
    return { ok: false, error: "Invalid JSON from hub" };
  }
  return {
    ok: true,
    balance: typeof data.balance === "number" ? data.balance : 0,
    linked: typeof data.linked === "boolean" ? data.linked : false,
  };
}
