/**
 * Hub API: agent profile, credits, report-usage.
 * Used for hosted agents (credit deduction, profile-driven config).
 */

import { normalizeUrl } from "../../util/url.js";
import {
  buildUsagePayload,
  buildVoicePayload,
  generateNonce,
  signPayload,
} from "../attestation.js";

/** Result of POST /api/blocks/:id/join */
export type JoinBlockResult =
  | { ok: true; jwt: string; serverUrl: string; blockId: string; blockSlotId: string }
  | { ok: false; error: string; status?: number };

/** Agent profile from GET /api/agents/me (or bootstrap). Plan §4a. */
export type HubAgentProfile = {
  id?: string;
  name?: string;
  hosted?: boolean;
  accountId?: string | null;
  /** TTS/voice enabled for this agent. */
  voiceEnabled?: boolean;
  /** Daily credit budget (cap). */
  dailyCreditBudget?: number;
  /** Personality/backstory for system prompt. */
  soul?: string | null;
  /** Future: scheduled task definitions. schedule can be cron expression or interval in ms. */
  cronTasks?: Array<{ id: string; schedule: string; instruction: string; intervalMs?: number }>;
  /** Default block to join (from hub). */
  defaultBlock?: { blockId?: string; serverUrl?: string | null };
  default_space_id?: string;
  /** Future: quests this agent offers. */
  quests?: Array<{ id: string; title: string; description?: string; objectives?: string[] }>;
  [k: string]: unknown;
};

export type ReportUsageResult =
  | { ok: true; balanceAfter?: number }
  | { ok: false; error: string; status?: number };

export type CheckBalanceResult =
  | { ok: true; balance: number; linked: boolean }
  | { ok: false; error: string; status?: number };

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
 * POST /api/blocks/:id/join — JWT + serverUrl + blockSlotId for engine connection.
 */
export async function joinBlock(
  baseUrl: string,
  apiKey: string,
  blockId: string
): Promise<JoinBlockResult> {
  const base = normalizeUrl(baseUrl);
  const res = await hubPost(`${base}/api/blocks/${encodeURIComponent(blockId)}/join`, apiKey);
  if (!res.ok) return { ok: false, error: res.error, status: res.status };
  let data: { jwt?: string; serverUrl?: string; blockId?: string; regionId?: string };
  try {
    data = JSON.parse(res.text) as { jwt?: string; serverUrl?: string; blockId?: string; regionId?: string };
  } catch {
    return { ok: false, error: "Invalid JSON from hub" };
  }
  const jwt = data.jwt;
  if (!jwt || typeof jwt !== "string") return { ok: false, error: "Hub response missing jwt" };
  const blockSlotId = (typeof data.regionId === "string" && data.regionId.trim()) || "0_0";
  const serverUrl =
    typeof data.serverUrl === "string" && data.serverUrl.trim() !== "" ? data.serverUrl.trim() : "";
  return {
    ok: true,
    jwt,
    serverUrl,
    blockId: typeof data.blockId === "string" ? data.blockId : blockId,
    blockSlotId,
  };
}

/**
 * GET /api/agents/me — agent profile (voiceEnabled, dailyCreditBudget, soul, etc.).
 */
export async function getAgentProfile(
  baseUrl: string,
  apiKey: string
): Promise<{ ok: true; profile: HubAgentProfile } | { ok: false; error: string }> {
  const base = normalizeUrl(baseUrl);
  const res = await hubGet(`${base}/api/agents/me`, apiKey);
  if (!res.ok) return { ok: false, error: res.error };
  let data: HubAgentProfile;
  try {
    data = JSON.parse(res.text) as HubAgentProfile;
  } catch {
    return { ok: false, error: "Invalid JSON from hub" };
  }
  return { ok: true, profile: data };
}

/**
 * POST /api/agents/me/report-usage.
 * Pass model + tokens; optionally costUsd for Google. Hub deducts from ledger.
 * When agentId and CLAW_ATTESTATION_PRIVATE_KEY are set, adds attestation (and blockId) for reward attribution.
 */
export async function reportUsage(
  baseUrl: string,
  apiKey: string,
  options: {
    promptTokens: number;
    completionTokens: number;
    model?: string;
    costUsd?: number;
    agentId?: string | null;
    blockId?: string | null;
  }
): Promise<ReportUsageResult> {
  const base = normalizeUrl(baseUrl);
  const body: Record<string, unknown> = {
    promptTokens: options.promptTokens,
    completionTokens: options.completionTokens,
    ...(options.model && { model: options.model }),
    ...(options.costUsd != null && Number.isFinite(options.costUsd) && { costUsd: options.costUsd }),
  };
  const privateKey = process.env.CLAW_ATTESTATION_PRIVATE_KEY?.trim();
  if (privateKey && options.agentId) {
    const timestamp = new Date().toISOString();
    const nonce = generateNonce();
    const payload = buildUsagePayload({
      agentId: options.agentId,
      blockId: options.blockId ?? null,
      promptTokens: options.promptTokens,
      completionTokens: options.completionTokens,
      model: options.model ?? "",
      timestamp,
      nonce,
    });
    body.attestation = { signature: signPayload(payload, privateKey), timestamp, nonce };
    if (options.blockId) body.blockId = options.blockId;
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
 * GET /api/agents/me/credits — current balance.
 */
export async function checkBalance(
  baseUrl: string,
  apiKey: string
): Promise<CheckBalanceResult> {
  const base = normalizeUrl(baseUrl);
  const res = await hubGet(`${base}/api/agents/me/credits`, apiKey);
  if (!res.ok) {
    if (res.status === 400 && res.error?.includes("no linked account")) {
      return { ok: true, balance: 0, linked: false };
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
 * POST /api/agents/me/report-usage with voice characters (TTS).
 * When agentId and CLAW_ATTESTATION_PRIVATE_KEY are set, adds attestation (and blockId).
 */
export async function reportVoiceUsage(
  baseUrl: string,
  apiKey: string,
  options: { characters: number; agentId?: string | null; blockId?: string | null }
): Promise<ReportUsageResult> {
  const base = normalizeUrl(baseUrl);
  const characters = Math.max(0, Math.floor(options.characters));
  const body: Record<string, unknown> = { type: "voice", characters };
  const privateKey = process.env.CLAW_ATTESTATION_PRIVATE_KEY?.trim();
  if (privateKey && options.agentId) {
    const timestamp = new Date().toISOString();
    const nonce = generateNonce();
    const payload = buildVoicePayload({
      agentId: options.agentId,
      blockId: options.blockId ?? null,
      characters,
      timestamp,
      nonce,
    });
    body.attestation = { signature: signPayload(payload, privateKey), timestamp, nonce };
    if (options.blockId) body.blockId = options.blockId;
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
