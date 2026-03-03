/**
 * Claw config from ENV. Call loadConfig() after dotenv so env vars are set.
 */

export type ClawConfig = {
  apiKey: string;
  hubUrl: string;
  /** Base URL for agent API (claw-config, PATCH me). Defaults to hubUrl. */
  agentApiUrl: string;
  engineUrl: string;
  spaceId: string | null;
  openRouterApiKey: string;
  chatLlmModel: string;
  buildLlmModel: string;
  ownerUserId: string | null;
  tickIntervalMs: number;
  maxChatContext: number;
  maxOwnerMessages: number;
  /** Whether this agent is platform-hosted (set at runtime from hub, not env). */
  hosted: boolean;
  /** How many tokens equal 1 credit (default 1000). */
  tokensPerCredit: number;
  /** Multiplier applied to build operations (default 1.5). */
  buildCreditMultiplier: number;
  /** Optional: skill IDs to request from claw-config (e.g. ["doppel", "doppel-block-builder"]). */
  skillIds: string[];
};

const DEFAULT_HUB = "http://localhost:4000";
const DEFAULT_ENGINE = "http://localhost:2567";
const DEFAULT_TICK_MS = 5000;
const DEFAULT_MAX_CHAT = 20;
const DEFAULT_MAX_OWNER = 10;

/** Parse env as int with default; clamp to [min, max] when provided. */
function parseIntEnv(
  key: string,
  defaultVal: number,
  min?: number,
  max?: number
): number {
  const raw = process.env[key];
  const n = raw != null ? parseInt(raw, 10) : NaN;
  let val = Number.isFinite(n) ? n : defaultVal;
  if (min != null && val < min) val = min;
  if (max != null && val > max) val = max;
  return val;
}

/** Trim and strip trailing slash from URL. */
function trimUrl(s: string): string {
  return s.trim().replace(/\/$/, "");
}

/**
 * Load config from process.env. Throws if required vars (DOPPEL_AGENT_API_KEY, OPENROUTER_API_KEY) are missing.
 */
export function loadConfig(): ClawConfig {
  const apiKey = process.env.DOPPEL_AGENT_API_KEY?.trim();
  if (!apiKey) throw new Error("DOPPEL_AGENT_API_KEY is required");

  const openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!openRouterApiKey) throw new Error("OPENROUTER_API_KEY is required");

  const hubUrl = trimUrl(process.env.HUB_URL?.trim() || DEFAULT_HUB);
  const agentApiUrl = trimUrl(process.env.AGENT_API_URL?.trim() || hubUrl);
  const engineUrl = trimUrl(process.env.ENGINE_URL?.trim() || DEFAULT_ENGINE);
  const spaceId = process.env.SPACE_ID?.trim() || null;
  const ownerUserId = process.env.OWNER_USER_ID?.trim() || null;
  const skillIdsRaw = process.env.SKILL_IDS?.trim();
  const skillIds =
    skillIdsRaw != null && skillIdsRaw !== ""
      ? skillIdsRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

  const tickIntervalMs = Math.max(2000, parseIntEnv("TICK_INTERVAL_MS", DEFAULT_TICK_MS));
  const maxChatContext = parseIntEnv("MAX_CHAT_CONTEXT", DEFAULT_MAX_CHAT, 5, 100);
  const maxOwnerMessages = parseIntEnv("MAX_OWNER_MESSAGES", DEFAULT_MAX_OWNER, 1, 50);

  const tokensPerCredit = parseIntEnv("TOKENS_PER_CREDIT", 1000, 1);

  const rawMultiplier = process.env.BUILD_CREDIT_MULTIPLIER;
  const parsedMultiplier = rawMultiplier != null ? parseFloat(rawMultiplier) : NaN;
  const buildCreditMultiplier = Number.isFinite(parsedMultiplier) && parsedMultiplier > 0
    ? parsedMultiplier
    : 1.5;

  return {
    apiKey,
    hubUrl,
    agentApiUrl,
    engineUrl,
    spaceId,
    openRouterApiKey,
    chatLlmModel: process.env.CHAT_LLM_MODEL?.trim() || "openrouter/auto",
    buildLlmModel: process.env.BUILD_LLM_MODEL?.trim() || "openrouter/auto",
    ownerUserId,
    tickIntervalMs,
    maxChatContext,
    maxOwnerMessages,
    hosted: false, // set at runtime from hub profile
    tokensPerCredit,
    buildCreditMultiplier,
    skillIds,
  };
}
