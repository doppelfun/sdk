/**
 * Claw config from ENV. Call loadConfig() after dotenv.
 */

import { DEFAULT_GOOGLE_MODEL } from "../llm/constants.js";

export type LlmProviderId = "openrouter" | "google" | "google-vertex";

export type ClawConfig = {
  apiKey: string;
  hubUrl: string;
  agentApiUrl: string;
  engineUrl: string;
  blockId: string | null;
  openRouterApiKey: string;
  chatLlmModel: string;
  buildLlmModel: string;
  ownerUserId: string | null;
  tickIntervalMs: number;
  wakeTickDebounceMs: number;
  maxChatContext: number;
  maxOwnerMessages: number;
  hosted: boolean;
  tokensPerCredit: number;
  buildCreditMultiplier: number;
  skillIds: string[];
  allowBuildWithoutCredits: boolean;
  llmProvider: LlmProviderId;
  googleApiKey: string | null;
  googleCloudProject: string | null;
  googleCloudLocation: string | null;
  /**
   * When true, no periodic LLM ticks when idle — same cadence as block NPCs: 50ms movement
   * driver only until DM/owner wake. When false, runTick is scheduled every tickIntervalMs even idle.
   */
  npcStyleIdle: boolean;
  /** Meters — owner within this distance ⇒ obedient mode (only Owner said / DMs). */
  ownerNearbyRadiusM: number;
  /**
   * When > 0 and owner is away: schedule LLM ticks this often so autonomous behavior
   * follows the SOUL (and skills). When 0, no autonomous ticks until wake.
   */
  autonomousSoulTickMs: number;
};

const DEFAULT_HUB = "http://localhost:4000";
const DEFAULT_ENGINE = "http://localhost:2567";
const DEFAULT_TICK_MS = 5000;
const DEFAULT_MAX_CHAT = 20;
const DEFAULT_MAX_OWNER = 10;

function parseIntEnv(key: string, defaultVal: number, min?: number, max?: number): number {
  const raw = process.env[key];
  const n = raw != null ? parseInt(raw, 10) : NaN;
  let val = Number.isFinite(n) ? n : defaultVal;
  if (min != null && val < min) val = min;
  if (max != null && val > max) val = max;
  return val;
}

function trimUrl(s: string): string {
  return s.trim().replace(/\/$/, "");
}

/** Truthy env flag (1 or true). */
function envFlag(key: string): boolean {
  const v = process.env[key]?.trim().toLowerCase();
  return v === "1" || v === "true";
}

/** LLM_PROVIDER → LlmProviderId. Underscores normalized to hyphens (google_vertex → google-vertex). */
function parseLlmProvider(): LlmProviderId {
  const raw = (process.env.LLM_PROVIDER?.trim().toLowerCase() || "openrouter").replace(/_/g, "-");
  if (raw === "google-vertex") return "google-vertex";
  if (raw === "google") return "google";
  return "openrouter";
}

export function loadConfig(): ClawConfig {
  const apiKey = process.env.DOPPEL_AGENT_API_KEY?.trim();
  if (!apiKey) throw new Error("DOPPEL_AGENT_API_KEY is required");

  const openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim() || "";
  const llmProvider = parseLlmProvider();
  if (!openRouterApiKey && llmProvider === "openrouter") {
    throw new Error("OPENROUTER_API_KEY is required when LLM_PROVIDER is openrouter (default)");
  }

  const hubUrl = trimUrl(process.env.HUB_URL?.trim() || DEFAULT_HUB);
  const agentApiUrl = trimUrl(process.env.AGENT_API_URL?.trim() || hubUrl);
  const engineUrl = trimUrl(process.env.ENGINE_URL?.trim() || DEFAULT_ENGINE);
  const blockId = process.env.BLOCK_ID?.trim() || null;
  const ownerUserId = process.env.OWNER_USER_ID?.trim() || null;
  const skillIdsRaw = process.env.SKILL_IDS?.trim();
  const skillIds =
    skillIdsRaw != null && skillIdsRaw !== ""
      ? skillIdsRaw.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

  const tickIntervalMs = Math.max(2000, parseIntEnv("TICK_INTERVAL_MS", DEFAULT_TICK_MS));
  const wakeTickDebounceMs = parseIntEnv("WAKE_TICK_DEBOUNCE_MS", 150, 0, 2000);
  const maxChatContext = parseIntEnv("MAX_CHAT_CONTEXT", DEFAULT_MAX_CHAT, 5, 100);
  const maxOwnerMessages = parseIntEnv("MAX_OWNER_MESSAGES", DEFAULT_MAX_OWNER, 1, 50);
  const tokensPerCredit = parseIntEnv("TOKENS_PER_CREDIT", 1000, 1);
  const rawMultiplier = process.env.BUILD_CREDIT_MULTIPLIER;
  const parsedMultiplier = rawMultiplier != null ? parseFloat(rawMultiplier) : NaN;
  const buildCreditMultiplier =
    Number.isFinite(parsedMultiplier) && parsedMultiplier > 0 ? parsedMultiplier : 1.5;
  const allowBuildWithoutCredits =
    envFlag("ALLOW_BUILD_WITHOUT_CREDITS");
  // Default true: match NpcDriver (no polling LLM). Set CLAW_NPC_STYLE=0 to restore periodic idle ticks.
  const npcStyleIdle =
    process.env.CLAW_NPC_STYLE === undefined ? true : envFlag("CLAW_NPC_STYLE");
  const ownerNearbyRadiusM = parseIntEnv(
    "OWNER_NEARBY_RADIUS_M",
    14,
    4,
    80
  );
  // Soul-driven autonomous LLM when owner away; 0 = no autonomous ticks between wakes
  const autonomousSoulTickMs = parseIntEnv(
    "AUTONOMOUS_SOUL_TICK_MS",
    45000,
    0,
    300000
  );

  const gemini = llmProvider === "google" || llmProvider === "google-vertex";
  const defaultModel = gemini ? DEFAULT_GOOGLE_MODEL : "openrouter/auto";

  return {
    apiKey,
    hubUrl,
    agentApiUrl,
    engineUrl,
    blockId,
    openRouterApiKey,
    chatLlmModel: process.env.CHAT_LLM_MODEL?.trim() || defaultModel,
    buildLlmModel: process.env.BUILD_LLM_MODEL?.trim() || defaultModel,
    ownerUserId,
    tickIntervalMs,
    wakeTickDebounceMs,
    maxChatContext,
    maxOwnerMessages,
    hosted: false,
    tokensPerCredit,
    buildCreditMultiplier,
    skillIds,
    allowBuildWithoutCredits,
    llmProvider,
    googleApiKey: process.env.GOOGLE_API_KEY?.trim() || null,
    googleCloudProject: process.env.GOOGLE_CLOUD_PROJECT?.trim() || null,
    googleCloudLocation: process.env.GOOGLE_CLOUD_LOCATION?.trim() || null,
    npcStyleIdle,
    ownerNearbyRadiusM,
    autonomousSoulTickMs,
  };
}
