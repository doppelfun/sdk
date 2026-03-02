/**
 * Agent loop: bootstrap, connect, tick (Chat LLM + tools), reconnect, owner chat.
 */

import WebSocket from "ws";
import { createClient } from "@doppelfun/sdk";
import type { DoppelClient } from "@doppelfun/sdk";
import { joinSpace, spendCredits } from "./hub.js";
import { loadConfig, type ClawConfig } from "./config.js";
import {
  createInitialState,
  pushChat,
  pushOwnerMessage,
  setLastError,
  syncMainDocumentFromRegion,
  type ClawState,
} from "./state.js";
import { buildSystemContent, buildUserMessage } from "./prompts.js";
import type { ClawConfigPrompt } from "./prompts.js";
import { chatCompletion, type Usage } from "./openrouter.js";
import { CHAT_TOOLS, executeTool } from "./tools.js";
import { startCreditMonitor } from "./credit-monitor.js";

export type ToolCallResult = { ok: true; summary?: string } | { ok: false; error: string };

export type AgentRunOptions = {
  /** Called when the agent connects (after authenticated). Receives regionId and engineUrl so you can log where to view the agent. */
  onConnected?: (regionId: string, engineUrl: string) => void;
  /** Called when the agent disconnects or errors. */
  onDisconnect?: (err?: Error) => void;
  /** Called each tick with a short log line (optional). */
  onTick?: (summary: string) => void;
  /** Called after each tool execution with name, args JSON, and result. Use to log full tool call responses. */
  onToolCallResult?: (name: string, args: string, result: ToolCallResult) => void;
  /** Override soul (skips API fetch for soul when set). */
  soul?: string | null;
  /** Override skills (skips API fetch for skills when set). */
  skills?: string | null;
  /** Skill IDs to request from the standard skills API (overrides config skillIds when set). */
  skillIds?: string[];
};

/** Response from GET /api/agents/me: profile, soul, and default space. */
type AgentBootstrapResponse = {
  hosted?: boolean;
  soul?: string | null;
  defaultSpace?: { spaceId: string; serverUrl: string | null } | null;
};

/** Fetch agent profile and soul from GET /api/agents/me (single bootstrap call). */
async function fetchAgentBootstrap(
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

/** Skill entry from GET /api/skills (ids=...). */
type SkillEntry = { name?: string; content?: string };

/** Fetch skills by ids from GET /api/skills?ids=... and return concatenated content. */
async function fetchSkills(
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
 * defaultSpaceFromBootstrap: from GET /api/agents/me (defaultSpace), used when SPACE_ID env is not set.
 */
async function getJwtAndEngineUrl(
  config: ClawConfig,
  defaultSpaceFromBootstrap?: { spaceId: string; serverUrl: string | null } | null
): Promise<{
  jwt: string;
  engineUrl: string;
  spaceId: string;
  regionId: string;
}> {
  let spaceId = config.spaceId;
  let engineUrl = config.engineUrl;

  if (!spaceId && defaultSpaceFromBootstrap?.spaceId) {
    spaceId = defaultSpaceFromBootstrap.spaceId;
    if (defaultSpaceFromBootstrap.serverUrl) engineUrl = defaultSpaceFromBootstrap.serverUrl;
  }

  if (!spaceId) {
    throw new Error(
      "No space to join: set a default space for this agent in the hub, or set SPACE_ID"
    );
  }

  const join = await joinSpace(config.hubUrl, config.apiKey, spaceId);
  if (!join.ok) throw new Error(`Join space failed: ${join.error}`);
  if (join.serverUrl) engineUrl = join.serverUrl;

  return {
    jwt: join.jwt,
    engineUrl,
    spaceId,
    regionId: join.regionId ?? "0_0",
  };
}

// --- Credit helpers (hosted agents only) ---

/** Convert token usage to credit amount. */
function tokensToCredits(usage: Usage, tokensPerCredit: number): number {
  return usage.total_tokens / tokensPerCredit;
}

/** Report usage to hub (fire-and-forget). Only called when config.hosted is true. */
function reportUsage(
  config: ClawConfig,
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
  state: ClawState,
  config: ClawConfig,
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
    const args = typeof tc.function.arguments === "string" ? tc.function.arguments : "";
    const execResult = await executeTool(
      client,
      state,
      config,
      { name, arguments: args }
    );
    options.onToolCallResult?.(name, args, execResult);
    options.onTick?.(`${name}: ${execResult.ok ? execResult.summary ?? "ok" : execResult.error}`);
    state.lastToolRun = name;
  }
  if (sentChatThisTick) state.lastTickSentChat = true;
}

/**
 * Start the agent: resolve JWT/engine, create client, connect, run tick loop.
 * On disconnect the tick will fail; use onDisconnect to restart (e.g. pm2).
 */
export async function runAgent(options: AgentRunOptions = {}): Promise<void> {
  const config = loadConfig();

  // --- Bootstrap: agent + soul + defaultSpace in one request, then skills from standard API ---
  let soul: string | null = null;
  let skills = "";
  let bootstrap: AgentBootstrapResponse = {};

  try {
    bootstrap = await fetchAgentBootstrap(config.agentApiUrl, config.apiKey);
    if (typeof bootstrap.hosted === "boolean") config.hosted = bootstrap.hosted;
    if (config.hosted) options.onTick?.("hosted agent — credit deduction enabled");
    if (bootstrap.soul !== undefined) soul = bootstrap.soul ?? null;
  } catch (e) {
    options.onTick?.(`bootstrap (agent+soul) failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (options.soul !== undefined) soul = options.soul ?? null;
  if (options.skills !== undefined) {
    skills = options.skills ?? "";
  } else {
    const skillIds = options.skillIds ?? config.skillIds;
    if (skillIds.length > 0) {
      try {
        skills = await fetchSkills(config.agentApiUrl, config.apiKey, skillIds);
        const gotSkills = Boolean(skills.trim());
        console.log(
          "[agent] Skills: skillIds=",
          skillIds,
          "->",
          gotSkills ? `${skills.length} chars` : "no skills returned"
        );
      } catch (e) {
        console.warn("[agent] Failed to fetch skills, using soul only:", e);
      }
    }
  }

  const clawConfigPrompt: ClawConfigPrompt = { soul, skills };
  const systemContent = buildSystemContent(clawConfigPrompt);
  console.log("[agent] System prompt (on start):\n" + systemContent);

  // --- Bootstrap: JWT + engine URL (join or create-then-join) ---
  let jwt: string;
  let engineUrl: string;
  let spaceId: string;
  let regionId: string;
  try {
    const resolved = await getJwtAndEngineUrl(config, bootstrap?.defaultSpace ?? null);
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
      syncMainDocumentFromRegion(state);
    }
    if (typeof p.sessionId === "string") state.mySessionId = p.sessionId;
    options.onConnected?.(state.regionId, engineUrl);
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
      syncMainDocumentFromRegion(state);
    }
  });

  await client.connect();

  // --- Tick loop: one tick at a time, schedule next only after current tick (and all tool runs) complete ---
  let tickScheduled: ReturnType<typeof setTimeout> | null = null;
  let tickInProgress = false;

  const runTickThenScheduleNext = (): void => {
    if (tickInProgress) return;
    tickInProgress = true;
    runTick(client, state, config, systemContent, options)
      .catch((e) => {
        options.onTick?.(`tick error: ${e instanceof Error ? e.message : String(e)}`);
      })
      .finally(() => {
        tickInProgress = false;
        tickScheduled = setTimeout(runTickThenScheduleNext, config.tickIntervalMs);
      });
  };

  tickScheduled = setTimeout(runTickThenScheduleNext, config.tickIntervalMs);

  // Start credit monitor (auto-tops-up OpenRouter credits via hub spender)
  if (config.hubUrl && config.apiKey) {
    startCreditMonitor(config, options.onTick);
  }

  // Note: SDK does not expose the WebSocket; on disconnect the next tick will fail and onDisconnect can be used by caller to restart (e.g. pm2).
}
