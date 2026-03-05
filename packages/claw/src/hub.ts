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

