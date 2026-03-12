/**
 * Agent loop: bootstrap, connect, tick (Chat LLM + tools), reconnect, owner chat.
 */

import WebSocket from "ws";
import { createClient } from "@doppelfun/sdk";
import type { DoppelClient } from "@doppelfun/sdk";
import { joinBlock, reportUsage as hubReportUsage } from "../hub/hub.js";
import { loadConfig, type ClawConfig } from "../config/config.js";
import {
  createInitialState,
  pushChat,
  pushOwnerMessage,
  setLastError,
  syncMainDocumentForBlock,
  type ClawState,
} from "../state/state.js";
import { buildSystemContent, buildUserMessage } from "../prompts/prompts.js";
import type { ClawConfigPrompt } from "../prompts/prompts.js";
import type { Usage } from "../llm/usage.js";
import { runTickWithAiSdk, MUST_ACT_BUILD_TOOL_NAMES } from "../llm/toolsAi.js";
import { isDmChannel } from "../../util/dm.js";
import { createLlmProvider, type BuildIntentResult } from "../llm/provider.js";
import { executeTool } from "../tools/tools.js";
import {
  movementDriverTick,
  MOVEMENT_INPUT_INTERVAL_MS,
} from "../movement/movementDriver.js";
import { isOwnerNearby } from "../movement/ownerProximity.js";
import { clawLog, clawDebug, clawVerbose } from "../log.js";

export type ToolCallResult = { ok: true; summary?: string } | { ok: false; error: string };

export type AgentRunOptions = {
  /** Called when the agent connects (after authenticated). Receives blockSlotId and engineUrl so you can log where to view the agent. */
  onConnected?: (blockSlotId: string, engineUrl: string) => void;
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

/** Response from GET /api/agents/me: profile, soul, and default block (hub may still call it defaultSpace). */
type AgentBootstrapResponse = {
  hosted?: boolean;
  soul?: string | null;
  defaultSpace?: { blockId: string; serverUrl: string | null } | null;
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

/** Payload shape for WebSocket "chat" messages from the engine. userId is always set by the server. */
type ChatPayload = {
  username?: string;
  message?: string;
  text?: string;
  createdAt?: number;
  timestamp?: number;
  userId: string;
  sessionId?: string;
  /** "global" or "dm:sessionA:sessionB". Use to filter or bucket by channel. */
  channelId?: string;
};

/** Payload shape for WebSocket "error" messages. */
type ErrorPayload = { code?: string; error?: string; regionId?: string };

/**
 * Resolve engine URL and JWT: join existing block or create then join.
 * defaultSpaceFromBootstrap: from GET /api/agents/me (defaultSpace JSON field), used when BLOCK_ID env is not set.
 */
async function getJwtAndEngineUrl(
  config: ClawConfig,
  defaultSpaceFromBootstrap?: { blockId: string; serverUrl: string | null } | null
): Promise<{
  jwt: string;
  engineUrl: string;
  blockId: string;
  blockSlotId: string;
}> {
  let blockId = config.blockId;
  let engineUrl = config.engineUrl;

  if (!blockId && defaultSpaceFromBootstrap?.blockId) {
    blockId = defaultSpaceFromBootstrap.blockId;
    if (defaultSpaceFromBootstrap.serverUrl) engineUrl = defaultSpaceFromBootstrap.serverUrl;
  }

  if (!blockId) {
    throw new Error(
      "No block to join: set a default block for this agent in the hub, or set BLOCK_ID"
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

// --- Credit helpers (hosted agents only) ---

/**
 * Report chat LLM usage to hub (fire-and-forget).
 * Hub: POST /api/agents/me/report-usage — deducts from ledger from model + token counts.
 */
function reportChatUsageToHub(
  config: ClawConfig,
  usage: Usage | null,
  onTick?: (summary: string) => void
): void {
  // Local dev: no ledger deduction — avoids tick spam when balance is 0
  if (config.allowBuildWithoutCredits) return;
  if (!usage || usage.total_tokens === 0) return;
  const promptTokens = Math.max(0, Math.floor(usage.prompt_tokens));
  const completionTokens = Math.max(0, Math.floor(usage.completion_tokens));
  if (promptTokens === 0 && completionTokens === 0) return;
  const provider = createLlmProvider(config);
  const costUsd = provider.usageCostUsdBeforeMarkup(
    { ...usage, prompt_tokens: promptTokens, completion_tokens: completionTokens },
    config.chatLlmModel
  );
  hubReportUsage(config.hubUrl, config.apiKey, {
    promptTokens,
    completionTokens,
    ...(costUsd != null
      ? { costUsd, model: config.chatLlmModel }
      : { model: config.chatLlmModel }),
  }).then(
    (res) => {
      if (!res.ok) onTick?.(`report-usage failed: ${res.error}`);
    }
  ).catch((e) => {
    onTick?.(`report-usage error: ${e instanceof Error ? e.message : String(e)}`);
  });
}

// --- Tick: prompt + LLM + tool execution ---

const MUST_ACT_MAX_TICKS = 4;
const BUILD_TOOLS = new Set(["generate_procedural", "build_full", "build_incremental"]);

function ownerBuildBlocked(config: ClawConfig, state: ClawState): boolean {
  return (
    config.hosted &&
    Boolean(config.ownerUserId) &&
    state.lastTriggerUserId !== config.ownerUserId
  );
}

function clearMustActBuild(state: ClawState): void {
  state.tickPhase = "idle";
  state.pendingBuildKind = null;
  state.pendingBuildTicks = 0;
}

/**
 * Run one tick: optional deterministic procedural build, else build-only LLM, else normal LLM.
 * Tick phase must_act_build withholds chat until a build tool succeeds or phase times out.
 */
async function runTick(
  client: DoppelClient,
  state: ClawState,
  config: ClawConfig,
  systemContent: string,
  options: AgentRunOptions
): Promise<void> {
  const tickParts = ["phase=" + state.tickPhase];
  if (state.pendingBuildKind) tickParts.push("pendingBuild=" + state.pendingBuildKind);
  if (state.tickPhase === "must_act_build")
    tickParts.push("buildTicks=" + state.pendingBuildTicks);
  clawLog("tick", ...tickParts);

  const boundarySlot = state.lastError?.blockSlotId;
  if (state.lastError?.code === "region_boundary" && boundarySlot) {
    client.sendJoin(boundarySlot);
    state.blockSlotId = boundarySlot;
    state.lastError = null;
    options.onTick?.(`join_block: ${state.blockSlotId} (auto from boundary)`);
  }

  state.lastTickToolNames = [];
  const onToolResult = (name: string, args: string, execResult: ToolCallResult) => {
    state.lastTickToolNames!.push(name);
    options.onToolCallResult?.(name, args, execResult);
    options.onTick?.(`${name}: ${execResult.ok ? execResult.summary ?? "ok" : execResult.error}`);
    state.lastToolRun = name;
    if (execResult.ok && BUILD_TOOLS.has(name)) {
      clearMustActBuild(state);
    }
  };

  // --- must_act_build phase ---
  if (state.tickPhase === "must_act_build") {
    state.pendingBuildTicks += 1;
    if (state.pendingBuildTicks > MUST_ACT_MAX_TICKS) {
      options.onTick?.("must_act_build: timeout, returning to idle");
      clearMustActBuild(state);
    } else if (ownerBuildBlocked(config, state)) {
      options.onTick?.("must_act_build: owner gate blocks build, clearing phase");
      clearMustActBuild(state);
    } else if (state.pendingBuildKind) {
      // Deterministic procedural — no LLM
      const kind = state.pendingBuildKind;
      const argsJson = JSON.stringify({ kind });
      const execResult = await executeTool(client, state, config, {
        name: "generate_procedural",
        args: { kind },
      });
      onToolResult("generate_procedural", argsJson, execResult);
      if (!execResult.ok) {
        options.onTick?.(`deterministic generate_procedural failed: ${execResult.error}`);
        state.pendingBuildKind = null;
        // Stay in must_act_build so LLM can try build_full next, or timeout
      }
      state.lastTickToolNames = null;
      return;
    } else {
      // LLM with build-only tools, no chat
      const userContent =
        buildUserMessage(state, config) +
        "\n\n[Phase: must_act_build — chat is disabled until you run generate_procedural or build_full/build_incremental. " +
        "Call one of those now; do not call chat.]";
      const result = await runTickWithAiSdk(
        client,
        state,
        config,
        systemContent,
        userContent,
        onToolResult,
        { omitChat: true, allowOnlyTools: MUST_ACT_BUILD_TOOL_NAMES }
      );
      if (!result.ok) options.onTick?.(`LLM error: ${result.error}`);
      else if (config.hosted) reportChatUsageToHub(config, result.usage, options.onTick);
      if (result.ok && !result.hadToolCalls) options.onTick?.("must_act_build: no tool calls");
      state.lastTickToolNames = null;
      return;
    }
  }

  // --- idle: normal tick ---
  // Wake-only LLM, or soul-driven autonomous tick when owner away (AUTONOMOUS_SOUL_TICK_MS > 0).
  let soulTick = state.autonomousSoulTickDue;
  if (soulTick && config.ownerUserId && state.myPosition && isOwnerNearby(state, config)) {
    state.autonomousSoulTickDue = false;
    soulTick = false;
  }
  if (!state.llmWakePending && !state.lastError && !soulTick) {
    clawDebug("tick skip idle (no wake — LLM runs again on DM/owner message or error)");
    state.lastTickToolNames = null;
    return;
  }

  const userContent = buildUserMessage(state, config);
  if (soulTick) state.autonomousSoulTickDue = false;
  const result = await runTickWithAiSdk(client, state, config, systemContent, userContent, onToolResult);

  // One shot per wake; next interval tick waits until DM/owner/error again
  state.llmWakePending = false;

  if (!result.ok) {
    options.onTick?.(`LLM error: ${result.error}`);
    state.dmReplyPending = false;
    state.lastTickToolNames = null;
    return;
  }

  if (config.hosted) reportChatUsageToHub(config, result.usage, options.onTick);

  // DM wake but model returned no tool calls (common with Gemini) — send text as chat or minimal fallback
  if (
    state.dmReplyPending &&
    !result.hadToolCalls &&
    state.lastDmPeerSessionId &&
    result.ok &&
    "replyText" in result
  ) {
    const peer = state.lastDmPeerSessionId;
    const text =
      result.replyText && result.replyText.length > 0
        ? result.replyText
        : "Hey — I'm here.";
    client.sendChat(text, { targetSessionId: peer });
    state.lastAgentChatMessage = text;
    state.lastTickSentChat = true;
    state.lastToolRun = "chat";
    options.onTick?.(`dm fallback chat: ${text.slice(0, 60)}${text.length > 60 ? "…" : ""}`);
  } else if (!result.hadToolCalls) {
    options.onTick?.("no tool calls");
  }

  state.dmReplyPending = false;
  state.lastTickToolNames = null;
}

/**
 * Start the agent: resolve JWT/engine, create client, connect, run tick loop.
 * On disconnect the tick will fail; use onDisconnect to restart (e.g. pm2).
 */
export async function runAgent(options: AgentRunOptions = {}): Promise<void> {
  const config = loadConfig();

  // --- Bootstrap: agent + soul + default block in one request (API field may still be defaultSpace), then skills ---
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
  let blockId: string;
  let blockSlotId: string;
  try {
    const resolved = await getJwtAndEngineUrl(config, bootstrap?.defaultSpace ?? null);
    jwt = resolved.jwt;
    engineUrl = resolved.engineUrl;
    blockId = resolved.blockId;
    blockSlotId = resolved.blockSlotId;
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

  const state = createInitialState(blockSlotId);

  // --- Tick loop state (must exist before chat handler so DM can wake immediately) ---
  let tickScheduled: ReturnType<typeof setTimeout> | null = null;
  let tickInProgress = false;
  /** When true, after current tick finishes schedule next with 0 delay (message arrived mid-tick). */
  let wakeAfterTick = false;

  const runTickThenScheduleNext = (): void => {
    if (tickInProgress) {
      clawDebug("tick skipped (already in progress)");
      return;
    }
    tickInProgress = true;
    runTick(client, state, config, systemContent, options)
      .catch((e) => {
        options.onTick?.(`tick error: ${e instanceof Error ? e.message : String(e)}`);
      })
      .finally(() => {
        tickInProgress = false;
        const needImmediateFollowUp = wakeAfterTick;
        wakeAfterTick = false;
        if (tickScheduled) clearTimeout(tickScheduled);
        tickScheduled = null;

        // NPC-style (NpcDriver): no periodic LLM — only 50ms movement driver until wake.
        // Schedule next runTick only when something still needs follow-up.
        let delayMs: number | null = null;
        if (needImmediateFollowUp) delayMs = 0;
        else if (state.tickPhase === "must_act_build") delayMs = 0;
        else if (state.lastError) delayMs = config.tickIntervalMs; // retry error / join_block
        else if (config.npcStyleIdle && !state.llmWakePending) {
          // Owner away + soul tick interval ⇒ schedule LLM to act per SOUL
          const ownerAway =
            config.ownerUserId &&
            config.autonomousSoulTickMs > 0 &&
            state.myPosition &&
            !isOwnerNearby(state, config);
          if (ownerAway) {
            state.autonomousSoulTickDue = true;
            delayMs = config.autonomousSoulTickMs;
            clawDebug("next soul tick in", delayMs, "ms (owner away)");
          } else delayMs = null;
        } else delayMs = config.tickIntervalMs;

        if (delayMs != null) {
          clawDebug("next tick in", delayMs, "ms");
          tickScheduled = setTimeout(runTickThenScheduleNext, delayMs);
        } else {
          clawDebug("idle — no LLM tick scheduled (NPC-style; wake on DM/owner)");
        }
      });
  };

  /**
   * Schedule a tick soon after chat that should trigger a reply (DM or owner).
   * Debounced so burst messages become one tick; if a tick is already running, run again right after.
   */
  let wakeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  const requestWakeTick = (reason: string, wakeMessage?: string): void => {
    state.llmWakePending = true;
    if (reason === "dm") state.dmReplyPending = true;
    if (tickInProgress) {
      wakeAfterTick = true;
      options.onTick?.(`wake after tick (${reason})`);
      return;
    }
    if (wakeDebounceTimer) clearTimeout(wakeDebounceTimer);
    const debounceMs = config.wakeTickDebounceMs;
    const msg = wakeMessage?.trim() ?? "";
    wakeDebounceTimer = setTimeout(() => {
      wakeDebounceTimer = null;
      if (tickInProgress) {
        wakeAfterTick = true;
        return;
      }
      if (tickScheduled) clearTimeout(tickScheduled);
      tickScheduled = null;
      options.onTick?.(`wake tick (${reason})`);
      void (async () => {
        if (msg && !ownerBuildBlocked(config, state)) {
          try {
            client.sendThinking(true);
            let intent: BuildIntentResult;
            try {
              intent = await createLlmProvider(config).classifyBuildIntent(
                msg,
                config.buildLlmModel
              );
            } finally {
              client.sendThinking(false);
            }
            if (intent.requiresBuildAction) {
              state.tickPhase = "must_act_build";
              state.pendingBuildKind = intent.proceduralKind;
              state.pendingBuildTicks = 0;
              state.lastTickSentChat = false;
              options.onTick?.(
                intent.proceduralKind
                  ? `must_act_build: ${intent.proceduralKind}`
                  : "must_act_build (build-only)"
              );
            }
          } catch (e) {
            options.onTick?.(
              `intent classify error: ${e instanceof Error ? e.message : String(e)}`
            );
          }
        }
        runTickThenScheduleNext();
      })();
    }, debounceMs);
  };

  // --- WebSocket message handlers (chat, error, joined, authenticated) ---
  client.onMessage("authenticated", async (payload: unknown) => {
    const p = payload as { regionId?: string; sessionId?: string };
    if (typeof p.regionId === "string") {
      state.blockSlotId = p.regionId;
      blockSlotId = p.regionId;
      syncMainDocumentForBlock(state);
    }
    if (typeof p.sessionId === "string") state.mySessionId = p.sessionId;
    options.onConnected?.(state.blockSlotId, engineUrl);
  });

  client.onMessage("chat", (payload: unknown) => {
    const p = payload as ChatPayload;
    if (state.mySessionId && p.sessionId === state.mySessionId) return;
    const username = typeof p.username === "string" ? p.username : "?";
    const message = typeof p.message === "string" ? p.message : typeof p.text === "string" ? p.text : "";
    const createdAt = typeof p.createdAt === "number" ? p.createdAt : p.timestamp ?? Date.now();
    const userId = typeof p.userId === "string" && p.userId.trim() ? p.userId.trim() : undefined;
    const sessionId = typeof p.sessionId === "string" ? p.sessionId : undefined;
    /** DM from another participant — entire message is to you; reply with targetSessionId = sender. */
    const dmFromOther =
      state.mySessionId &&
      sessionId &&
      sessionId !== state.mySessionId &&
      isDmChannel(p.channelId);
    const fromOwner = config.ownerUserId && userId === config.ownerUserId && message;
    if (dmFromOther && sessionId) {
      state.lastDmPeerSessionId = sessionId;
    } else if (p.channelId === "global") {
      // Global broadcast — clear DM focus so replies go to room unless agent sets targetSessionId
      state.lastDmPeerSessionId = null;
    }
    const shouldWake = fromOwner || dmFromOther;
    if (shouldWake) {
      state.lastAgentChatMessage = null;
      state.lastTickSentChat = false;
      if (userId) state.lastTriggerUserId = userId;
    }
    pushChat(
      state,
      {
        username,
        message,
        createdAt,
        userId,
        sessionId,
        channelId: typeof p.channelId === "string" ? p.channelId : undefined,
      },
      config.maxChatContext
    );
    if (fromOwner) {
      pushOwnerMessage(state, message, config.maxOwnerMessages);
    }
    // DM or owner → run LLM soon instead of waiting full tick interval
    if (shouldWake && message.trim()) {
      const reason = dmFromOther ? "dm" : "owner";
      clawLog("chat wake", reason, "from=" + username, "channel=" + (p.channelId ?? "?"));
      if (clawVerbose()) clawDebug("message preview:", message.trim().slice(0, 200));
      requestWakeTick(reason, message.trim());
    }
  });

  client.onMessage("error", (payload: unknown) => {
    const p = payload as ErrorPayload;
    const code = typeof p.code === "string" ? p.code : "error";
    const message = typeof p.error === "string" ? p.error : "Unknown error";
    const slot = typeof p.regionId === "string" ? p.regionId : undefined;
    setLastError(state, code, message, slot);
  });

  client.onMessage("joined", (payload: unknown) => {
    const p = payload as { regionId?: string };
    if (typeof p.regionId === "string") {
      state.blockSlotId = p.regionId;
      state.lastError = null;
      state.lastDmPeerSessionId = null;
      syncMainDocumentForBlock(state);
    }
  });

  await client.connect();

  // --- Refresh occupants for owner proximity (isOwnerNearby) ---
  const OCCUPANTS_REFRESH_MS = 8000;
  let occupantsRefreshTimer: ReturnType<typeof setInterval> | null = null;
  if (config.ownerUserId) {
    occupantsRefreshTimer = setInterval(() => {
      if (tickInProgress) return;
      client.getOccupants().then((list) => {
        state.occupants = list;
        const self = list.find((o) => o.clientId === state.mySessionId);
        if (self?.position) state.myPosition = self.position;
      }).catch(() => {});
    }, OCCUPANTS_REFRESH_MS);
  }

  // --- 50ms movement driver: explicit movementTarget only (LLM/soul ticks set target) ---
  const movementInterval = setInterval(() => {
    try {
      movementDriverTick(client, state);
    } catch {
      // ignore
    }
  }, MOVEMENT_INPUT_INTERVAL_MS);

  const clearMovementInterval = (): void => {
    clearInterval(movementInterval);
  };
  // Best-effort cleanup if client exposes close
  const clientAny = client as unknown as { close?: () => void };
  if (typeof clientAny.close === "function") {
    const orig = clientAny.close.bind(client);
    clientAny.close = () => {
      if (occupantsRefreshTimer) clearInterval(occupantsRefreshTimer);
      clearMovementInterval();
      orig();
    };
  }

  // --- First tick: NPC-style runs immediately (llmWakePending true); periodic style waits tickIntervalMs ---
  const firstDelay = config.npcStyleIdle ? 0 : config.tickIntervalMs;
  tickScheduled = setTimeout(runTickThenScheduleNext, firstDelay);
  // Note: SDK does not expose the WebSocket; on disconnect the next tick will fail and onDisconnect can be used by caller to restart (e.g. pm2).
}
