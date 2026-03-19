/**
 * Claw config from ENV. Hub profile (soul, voiceEnabled, voiceId, dailyCreditBudget) merged at bootstrap.
 */

import { parseIntEnv, envFlag } from "../../util/env.js";
import { normalizeUrl } from "../../util/url.js";

export type LlmProviderId = "openrouter" | "google" | "google-vertex" | "bankr";

export type ClawConfig = {
  apiKey: string;
  /** Agent UUID from hub profile (for attestation). */
  agentId: string | null;
  hubUrl: string;
  agentApiUrl: string;
  engineUrl: string;
  blockId: string | null;
  openRouterApiKey: string;
  /** Bankr LLM Gateway API key (X-API-Key). Required when LLM_PROVIDER=bankr. */
  bankrLlmApiKey: string | null;
  chatLlmModel: string;
  buildLlmModel: string;
  ownerUserId: string | null;
  maxChatContext: number;
  maxOwnerMessages: number;
  hosted: boolean;
  tokensPerCredit: number;
  skillIds: string[];
  llmProvider: LlmProviderId;
  googleApiKey: string | null;
  googleCloudProject: string | null;
  googleCloudLocation: string | null;
  /** Meters — owner within this distance for "owner nearby" checks. */
  ownerNearbyRadiusM: number;
  /** Meters — max distance to send DM to another agent; owner is always allowed. */
  chatNearbyRadiusM: number;
  /**
   * When > 0 and owner is away: request autonomous wake this often (ms).
   * Tree condition TimeForAutonomousWake uses this.
   */
  autonomousSoulTickMs: number;
  /** Min ms between autonomous LLM runs in soul mode. Real DMs bypass; tree uses CanRunAutonomousLlm. */
  autonomousLlmCooldownMs: number;
  /** Voice ID for TTS; from hub profile (fallback: CLAW_VOICE_ID env). */
  voiceId: string | null;
  /** From hub profile: voice enabled. */
  voiceEnabled: boolean;
  /** From hub profile: daily credit budget (enforced when hosted). */
  dailyCreditBudget: number;
  /** From hub profile: personality/backstory for system prompt. */
  soul: string | null;
  /** When true, skip balance check and report-usage (local dev). */
  skipCreditReport: boolean;
};

const DEFAULT_HUB = "https://doppel.fun";
const DEFAULT_ENGINE = "http://localhost:2567";
const DEFAULT_MAX_CHAT = 20;
const DEFAULT_MAX_OWNER = 10;

/**
 * Parse LLM_PROVIDER env: "openrouter" | "google" | "google-vertex" | "bankr".
 * Defaults to "google" when unset.
 */
function parseLlmProvider(): LlmProviderId {
  const raw = (process.env.LLM_PROVIDER?.trim().toLowerCase() || "google").replace(/_/g, "-");
  if (raw === "google-vertex") return "google-vertex";
  if (raw === "google") return "google";
  if (raw === "bankr") return "bankr";
  return "openrouter";
}

/**
 * Load ClawConfig from environment. Throws if required vars missing (e.g. DOPPEL_AGENT_API_KEY).
 * Validates API keys per LLM_PROVIDER (OPENROUTER_API_KEY for openrouter, GOOGLE_API_KEY for google, etc.).
 *
 * @returns Full config with defaults for optional env vars
 * @throws When required env is missing for the chosen provider
 */
export function loadConfig(): ClawConfig {
  const apiKey = process.env.DOPPEL_AGENT_API_KEY?.trim();
  if (!apiKey) throw new Error("DOPPEL_AGENT_API_KEY is required");

  const openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim() || "";
  const llmProvider = parseLlmProvider();
  if (!openRouterApiKey && llmProvider === "openrouter") {
    throw new Error("OPENROUTER_API_KEY is required when LLM_PROVIDER is openrouter");
  }
  if (llmProvider === "google" && !process.env.GOOGLE_API_KEY) {
    throw new Error("GOOGLE_API_KEY is required when LLM_PROVIDER is google");
  }
  if (llmProvider === "google-vertex" && !process.env.GOOGLE_CLOUD_PROJECT) {
    throw new Error("GOOGLE_CLOUD_PROJECT is required when LLM_PROVIDER is google-vertex");
  }
  if (llmProvider === "google-vertex" && !process.env.GOOGLE_CLOUD_LOCATION) {
    throw new Error("GOOGLE_CLOUD_LOCATION is required when LLM_PROVIDER is google-vertex");
  }
  const bankrLlmApiKey = process.env.BANKR_LLM_API_KEY?.trim() || null;
  if (llmProvider === "bankr" && !bankrLlmApiKey) {
    throw new Error("BANKR_LLM_API_KEY is required when LLM_PROVIDER is bankr");
  }

  const hubUrl = normalizeUrl(process.env.HUB_URL?.trim() || DEFAULT_HUB);
  const agentApiUrl = normalizeUrl(process.env.AGENT_API_URL?.trim() || hubUrl);
  const engineUrl = normalizeUrl(process.env.ENGINE_URL?.trim() || DEFAULT_ENGINE);
  const blockId = process.env.BLOCK_ID?.trim() || null;
  const agentId = process.env.DOPPEL_AGENT_ID?.trim() || null;
  const ownerUserId = process.env.OWNER_USER_ID?.trim() || null;
  const skillIdsRaw = process.env.SKILL_IDS?.trim() || "doppel-claw";
  const skillIds =
    skillIdsRaw !== ""
      ? skillIdsRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

  const maxChatContext = parseIntEnv("MAX_CHAT_CONTEXT", DEFAULT_MAX_CHAT, 5, 100);
  const maxOwnerMessages = parseIntEnv("MAX_OWNER_MESSAGES", DEFAULT_MAX_OWNER, 1, 50);
  const tokensPerCredit = parseIntEnv("TOKENS_PER_CREDIT", 1000, 1);
  const ownerNearbyRadiusM = parseIntEnv("OWNER_NEARBY_RADIUS_M", 4, 4, 80);
  const chatNearbyRadiusM = parseIntEnv("CHAT_NEARBY_RADIUS_M", 10, 2, 50);
  const autonomousSoulTickMs = parseIntEnv("AUTONOMOUS_SOUL_TICK_MS", 45000, 0, 300000);
  const autonomousLlmCooldownMs = parseIntEnv("AUTONOMOUS_LLM_COOLDOWN_MS", 25000, 5000, 120000);
  const voiceId = process.env.CLAW_VOICE_ID?.trim() || null;

  const defaultChatModel =
    llmProvider === "openrouter"
      ? "openrouter/auto"
      : llmProvider === "bankr"
        ? "claude-sonnet-4-20250514"
        : "gemini-3-flash-preview";
  const defaultBuildModel =
    llmProvider === "openrouter"
      ? "openrouter/auto"
      : llmProvider === "bankr"
        ? "claude-opus-4.6"
        : "gemini-3.1-pro-preview";
  return {
    apiKey,
    agentId,
    hubUrl,
    agentApiUrl,
    engineUrl,
    blockId,
    openRouterApiKey,
    bankrLlmApiKey,
    chatLlmModel: process.env.CHAT_LLM_MODEL?.trim() || defaultChatModel,
    buildLlmModel: process.env.BUILD_LLM_MODEL?.trim() || defaultBuildModel,
    ownerUserId,
    maxChatContext,
    maxOwnerMessages,
    hosted: false,
    tokensPerCredit,
    skillIds,
    llmProvider,
    googleApiKey: process.env.GOOGLE_API_KEY?.trim() || null,
    googleCloudProject: process.env.GOOGLE_CLOUD_PROJECT?.trim() || null,
    googleCloudLocation: process.env.GOOGLE_CLOUD_LOCATION?.trim() || null,
    ownerNearbyRadiusM,
    chatNearbyRadiusM,
    autonomousSoulTickMs,
    autonomousLlmCooldownMs,
    voiceId,
    voiceEnabled: true,
    dailyCreditBudget: 0,
    soul: null,
    skipCreditReport: envFlag("DISABLE_CREDITS"),
  };
}
