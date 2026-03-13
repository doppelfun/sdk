/**
 * Agent bootstrap: fetch profile/soul/skills and resolve JWT + engine URL for join.
 */

import { joinBlock } from "../hub/hub.js";
import type { ClawConfig } from "../config/config.js";
import type { AgentBootstrapResponse, SkillEntry } from "./types.js";

/**
 * Resolve default block from bootstrap response.
 * Uses profile defaultBlock / defaultSpace or default_space_id; returns null if none set.
 *
 * @param bootstrap - Response from GET /api/agents/me (or null/undefined).
 * @returns Block id and optional server URL, or null if no default block.
 */
export function defaultBlockFromBootstrap(
  bootstrap: AgentBootstrapResponse | null | undefined
): { blockId: string; serverUrl: string | null } | null {
  if (!bootstrap) return null;
  const nested = bootstrap.defaultBlock ?? bootstrap.defaultSpace ?? null;
  if (nested?.blockId && String(nested.blockId).trim()) {
    return {
      blockId: String(nested.blockId).trim(),
      serverUrl:
        nested.serverUrl != null && String(nested.serverUrl).trim()
          ? String(nested.serverUrl).trim()
          : null,
    };
  }
  const raw = bootstrap.default_space_id;
  if (raw != null && String(raw).trim()) {
    return { blockId: String(raw).trim(), serverUrl: null };
  }
  return null;
}

/**
 * Fetch agent profile and soul from hub API.
 *
 * @param agentApiUrl - Base URL of the agent/hub API (e.g. HUB_URL or AGENT_API_URL).
 * @param apiKey - Bearer token for Authorization header.
 * @returns Parsed response with hosted, soul, defaultBlock, etc.; empty object on non-OK.
 */
export async function fetchAgentBootstrap(
  agentApiUrl: string,
  apiKey: string
): Promise<AgentBootstrapResponse> {
  const base = agentApiUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/api/agents/me`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return {};
  return (await res.json()) as AgentBootstrapResponse;
}

/**
 * Fetch skills by ids from hub and return concatenated content.
 *
 * @param agentApiUrl - Base URL of the agent/hub API.
 * @param apiKey - Bearer token for Authorization header.
 * @param skillIds - Array of skill IDs to request (e.g. config.skillIds).
 * @returns Concatenated skill content separated by "---"; empty string on error or no ids.
 */
export async function fetchSkills(
  agentApiUrl: string,
  apiKey: string,
  skillIds: string[]
): Promise<string> {
  if (skillIds.length === 0) return "";
  const base = agentApiUrl.replace(/\/$/, "");
  const params = `?ids=${skillIds.map(encodeURIComponent).join(",")}`;
  const res = await fetch(`${base}/api/skills${params}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return "";
  const data = (await res.json()) as { skills?: SkillEntry[] };
  const skills = Array.isArray(data.skills) ? data.skills : [];
  return skills
    .map((s) => (typeof s.content === "string" ? s.content : "").trim())
    .filter(Boolean)
    .join("\n\n---\n\n");
}

/**
 * Resolve engine URL and JWT via joinBlock.
 * Profile default block (from bootstrap) wins over config.blockId / BLOCK_ID env.
 *
 * @param config - Claw config (hubUrl, apiKey, engineUrl, blockId).
 * @param bootstrap - Optional bootstrap response for default block.
 * @returns JWT, engine URL, block id, and block slot id for connect.
 * @throws Error if no block to join or joinBlock fails.
 */
export async function getJwtAndEngineUrl(
  config: ClawConfig,
  bootstrap: AgentBootstrapResponse | null | undefined
): Promise<{
  jwt: string;
  engineUrl: string;
  blockId: string;
  blockSlotId: string;
}> {
  const fromProfile = defaultBlockFromBootstrap(bootstrap);
  let blockId: string | null = null;
  let engineUrl = config.engineUrl;

  if (fromProfile?.blockId) {
    blockId = fromProfile.blockId;
    if (fromProfile.serverUrl) engineUrl = fromProfile.serverUrl;
  } else if (config.blockId) {
    blockId = config.blockId;
  }

  if (!blockId) {
    throw new Error(
      "No block to join: set default space for this agent in the hub (profile default_space_id), or set BLOCK_ID for local override"
    );
  }

  const join = await joinBlock(config.hubUrl, config.apiKey, blockId);
  if (!join.ok) throw new Error(`Join block failed: ${join.error}`);
  if (join.serverUrl) engineUrl = join.serverUrl;

  return {
    jwt: join.jwt,
    engineUrl,
    blockId,
    blockSlotId: join.blockSlotId || "0_0",
  };
}
