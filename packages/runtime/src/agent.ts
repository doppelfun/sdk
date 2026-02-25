/**
 * Agent loop: bootstrap, connect, tick (Chat LLM + tools), reconnect, owner chat.
 */

import WebSocket from "ws";
import { createClient } from "@doppel-sdk/core";
import type { DoppelClient } from "@doppel-sdk/core";
import { joinSpace, createSpace, getAgentProfile, spendCredits } from "./hub.js";
import { loadConfig, type RuntimeConfig } from "./config.js";
import {
  createInitialState,
  pushChat,
  pushOwnerMessage,
  setLastError,
  type RuntimeState,
} from "./state.js";
import { buildSystemContent, buildUserMessage } from "./prompts.js";
import type { RuntimeConfigPrompt } from "./prompts.js";
import { chatCompletion, type Usage } from "./openrouter.js";
import { CHAT_TOOLS, executeTool } from "./tools.js";

export type AgentRunOptions = {
  /** Called when the agent connects (after authenticated). */
  onConnected?: (regionId: string) => void;
  /** Called when the agent disconnects or errors. */
  onDisconnect?: (err?: Error) => void;
  /** Called each tick with a short log line (optional). */
  onTick?: (summary: string) => void;
  /** Override soul (skips API fetch for soul when set). */
  soul?: string | null;
  /** Override skills (skips API fetch for skills when set). */
  skills?: string | null;
  /** Skill IDs to request from runtime-config API (overrides config skillIds when set). */
  skillIds?: string[];
};

type RuntimeConfigResponse = {
  soul?: string | null;
  skills?: string;
  runtimeServerUrl?: string | null;
};

async function fetchRuntimeConfig(
  agentApiUrl: string,
  apiKey: string,
  skillIds: string[]
): Promise<RuntimeConfigResponse> {
  const base = agentApiUrl.replace(/\/$/, "");
  const params = skillIds.length > 0 ? `?skillIds=${skillIds.map(encodeURIComponent).join(",")}` : "";
  const res = await fetch(`${base}/api/agents/me/runtime-config${params}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return {};
  return (await res.json()) as RuntimeConfigResponse;
}

/** Payload shape for WebSocket "chat" messages from the engine. */
type ChatPayload = {
  username?: string;
  message?: string;
  text?: string;
  createdAt?: number;
  timestamp?: number;
  userId?: string;
  sessionId?: string;
  mentions?: Array<{ sessionId?: string; userId?: string; username?: string }>;
};

/** Payload shape for WebSocket "error" messages. */
type ErrorPayload = { code?: string; error?: string; regionId?: string };

/**
 * Resolve engine URL and JWT: join existing space or create then join.
 */
async function getJwtAndEngineUrl(config: RuntimeConfig): Promise<{
  jwt: string;
  engineUrl: string;
  spaceId: string;
  regionId: string;
}> {
  let spaceId = config.spaceId;
  let engineUrl = config.engineUrl;

  if (!spaceId && config.createSpaceOnStart) {
    const created = await createSpace(config.hubUrl, config.apiKey, {
      name: config.createSpaceName,
      maxAgents: 100,
    });
    if (!created.ok) throw new Error(`Create space failed: ${created.error}`);
    spaceId = created.spaceId;
    if (created.serverUrl) engineUrl = created.serverUrl;
  }

  if (!spaceId) throw new Error("SPACE_ID is required (or set CREATE_SPACE_ON_START=true)");

  const join = await joinSpace(config.hubUrl, config.apiKey, spaceId);
  if (!join.ok) throw new Error(`Join space failed: ${join.error}`);
  if (join.serverUrl) engineUrl = join.serverUrl;

  return {
    jwt: join.jwt,
    engineUrl,
    spaceId,
    regionId: "0_0",
  };
}

// --- Credit helpers (hosted agents only) ---

/** Convert token usage to credit amount. */
function tokensToCredits(usage: Usage, tokensPerCredit: number): number {
  return usage.total_tokens / tokensPerCredit;
}

/** Report usage to hub (fire-and-forget). Only called when config.hosted is true. */
function reportUsage(
  config: RuntimeConfig,
  usage: Usage | null,
  description: string,
  onTick?: (summary: string) => void
): void {
  if (!usage || usage.total_tokens === 0) return;
  const credits = tokensToCredits(usage, config.tokensPerCredit);
  if (credits <= 0) return;
  spendCredits(config.hubUrl, config.apiKey, credits, description).then((res) => {
    if (!res.ok) onTick?.(`credit spend failed: ${res.error}`);
  }).catch((e) => {
    onTick?.(`credit spend error: ${e instanceof Error ? e.message : String(e)}`);
  });
}

// --- Tick: prompt + LLM + tool execution ---

/**
 * Run one tick: build user message from state, call Chat LLM with tools, execute tool calls, update lastTickSentChat.
 * If we have a region_boundary error with regionId, join that region immediately so the agent doesn't get stuck.
 */
async function runTick(
  client: DoppelClient,
  state: RuntimeState,
  config: RuntimeConfig,
  systemContent: string,
  options: AgentRunOptions
): Promise<void> {
  if (state.lastError?.code === "region_boundary" && state.lastError.regionId) {
    client.sendJoin(state.lastError.regionId);
    state.regionId = state.lastError.regionId;
    state.lastError = null;
    options.onTick?.(`join_region: ${state.regionId} (auto from region_boundary)`);
  }

  const userContent = buildUserMessage(state, config);
  const tools =
    state.lastTickSentChat
      ? CHAT_TOOLS.filter((t) => t.function?.name !== "chat")
      : CHAT_TOOLS;
  const result = await chatCompletion(config.openRouterApiKey, {
    model: config.chatLlmModel,
    messages: [
      { role: "system", content: systemContent },
      { role: "user", content: userContent },
    ],
    tools,
    tool_choice: "auto",
    max_tokens: 1024,
  });

  if (!result.ok) {
    options.onTick?.(`LLM error: ${result.error}`);
    return;
  }

  // Report chat tick usage for hosted agents (fire-and-forget)
  if (config.hosted) {
    reportUsage(config, result.usage, "Chat tick", options.onTick);
  }

  const msg = result.message;
  const toolCalls = msg.tool_calls ?? [];
  if (toolCalls.length === 0) {
    options.onTick?.("no tool calls");
    return;
  }

  let sentChatThisTick = false;
  const executedThisTick = new Set<string>();
  for (const tc of toolCalls) {
    if (tc.type !== "function" || !tc.function) continue;
    const name = tc.function.name;
    if (executedThisTick.has(name)) continue;
    if (name === "chat") {
      if (state.lastTickSentChat) continue;
      sentChatThisTick = true;
    }
    executedThisTick.add(name);
    const execResult = await executeTool(
      client,
      state,
      config,
      { name, arguments: tc.function.arguments }
    );
    options.onTick?.(`${name}: ${execResult.ok ? execResult.summary ?? "ok" : execResult.error}`);
  }
  if (sentChatThisTick) state.lastTickSentChat = true;
}

/**
 * Start the agent: resolve JWT/engine, create client, connect, run tick loop.
 * On disconnect the tick will fail; use onDisconnect to restart (e.g. pm2).
 */
export async function runAgent(options: AgentRunOptions = {}): Promise<void> {
  const config = loadConfig();

  // --- Bootstrap: check hosted flag from hub ---
  try {
    const profileRes = await getAgentProfile(config.hubUrl, config.apiKey);
    if (profileRes.ok) {
      config.hosted = profileRes.profile.hosted;
      if (config.hosted) {
        options.onTick?.("hosted agent — credit deduction enabled");
      }
    }
  } catch (e) {
    // Non-fatal: default to not-hosted (no credit deduction)
    options.onTick?.(`profile check failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // --- Runtime config (soul + skills): options override or fetch from API ---
  let runtimeConfigPrompt: RuntimeConfigPrompt;
  if (options.soul !== undefined || options.skills !== undefined) {
    runtimeConfigPrompt = {
      soul: options.soul ?? null,
      skills: options.skills ?? "",
    };
  } else {
    const skillIds = options.skillIds ?? config.skillIds;
    try {
      const fetched = await fetchRuntimeConfig(config.agentApiUrl, config.apiKey, skillIds);
      runtimeConfigPrompt = {
        soul: fetched.soul ?? null,
        skills: fetched.skills ?? "",
      };
    } catch (e) {
      console.warn("[agent] Failed to fetch runtime-config, using base prompt only:", e);
      runtimeConfigPrompt = { soul: null, skills: "" };
    }
  }
  const systemContent = buildSystemContent(runtimeConfigPrompt);

  // --- Bootstrap: JWT + engine URL (join or create-then-join) ---
  let jwt: string;
  let engineUrl: string;
  let spaceId: string;
  let regionId: string;
  try {
    const resolved = await getJwtAndEngineUrl(config);
    jwt = resolved.jwt;
    engineUrl = resolved.engineUrl;
    spaceId = resolved.spaceId;
    regionId = resolved.regionId;
  } catch (e) {
    options.onDisconnect?.(e instanceof Error ? e : new Error(String(e)));
    throw e;
  }

  const getJwt = () => jwt;
  const client = createClient({
    engineUrl,
    getJwt,
    WebSocket: WebSocket as unknown as typeof globalThis.WebSocket,
    agentWsPath: "/connect",
  });

  const state = createInitialState(regionId);

  // --- WebSocket message handlers (chat, error, joined, authenticated) ---
  client.onMessage("authenticated", async (payload: unknown) => {
    const p = payload as { regionId?: string; sessionId?: string };
    if (typeof p.regionId === "string") {
      state.regionId = p.regionId;
      regionId = p.regionId;
    }
    if (typeof p.sessionId === "string") state.mySessionId = p.sessionId;
    options.onConnected?.(state.regionId);

    // Register runtime server URL if configured
    if (config.runtimePublicUrl) {
      try {
        const base = config.agentApiUrl.replace(/\/$/, "");
        const res = await fetch(`${base}/api/agents/me`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({ runtimeServerUrl: config.runtimePublicUrl }),
        });
        if (!res.ok) {
          console.warn("[agent] Failed to register runtimeServerUrl:", res.status);
        }
      } catch (e) {
        console.warn("[agent] Failed to register runtimeServerUrl:", e);
      }
    }
  });

  client.onMessage("chat", (payload: unknown) => {
    const p = payload as ChatPayload;
    if (state.mySessionId && p.sessionId === state.mySessionId) return;
    const username = typeof p.username === "string" ? p.username : "?";
    const message = typeof p.message === "string" ? p.message : typeof p.text === "string" ? p.text : "";
    const createdAt = typeof p.createdAt === "number" ? p.createdAt : p.timestamp ?? Date.now();
    const userId = typeof p.userId === "string" ? p.userId : undefined;
    const sessionId = typeof p.sessionId === "string" ? p.sessionId : undefined;
    const rawMentions = Array.isArray(p.mentions) ? p.mentions : [];
    const mentions = rawMentions
      .filter((m) => m && typeof m.sessionId === "string" && typeof m.username === "string")
      .map((m) => ({ sessionId: m.sessionId!, username: m.username! }));
    const addressingYou = state.mySessionId && mentions.some((m) => m.sessionId === state.mySessionId);
    const fromOwner = config.ownerUserId && userId === config.ownerUserId && message;
    if (addressingYou || fromOwner) {
      state.lastAgentChatMessage = null;
      state.lastTickSentChat = false;
      if (userId) state.lastTriggerUserId = userId;
    }
    pushChat(
      state,
      { username, message, createdAt, userId, sessionId, mentions: mentions.length ? mentions : undefined },
      config.maxChatContext
    );
    if (fromOwner) {
      pushOwnerMessage(state, message, config.maxOwnerMessages);
    }
  });

  client.onMessage("error", (payload: unknown) => {
    const p = payload as ErrorPayload;
    const code = typeof p.code === "string" ? p.code : "error";
    const message = typeof p.error === "string" ? p.error : "Unknown error";
    const regionId = typeof p.regionId === "string" ? p.regionId : undefined;
    setLastError(state, code, message, regionId);
  });

  client.onMessage("joined", (payload: unknown) => {
    const p = payload as { regionId?: string };
    if (typeof p.regionId === "string") {
      state.regionId = p.regionId;
      state.lastError = null;
    }
  });

  await client.connect();

  // --- Tick timer (no reconnect loop; caller can restart on disconnect) ---
  let tickTimer: ReturnType<typeof setInterval> | null = null;

  const scheduleTick = (): void => {
    if (tickTimer) return;
    tickTimer = setInterval(async () => {
      try {
        await runTick(client, state, config, systemContent, options);
      } catch (e) {
        options.onTick?.(`tick error: ${e instanceof Error ? e.message : String(e)}`);
      }
    }, config.tickIntervalMs);
  };

  scheduleTick();
  // Note: SDK does not expose the WebSocket; on disconnect the next tick will fail and onDisconnect can be used by caller to restart (e.g. pm2).
}
