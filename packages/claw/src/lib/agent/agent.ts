/**
 * Agent loop: bootstrap, connect, tick (Chat LLM + tools), reconnect, owner chat.
 */

import WebSocket from "ws";
import { createClient } from "@doppelfun/sdk";
import type { DoppelClient } from "@doppelfun/sdk";
import { joinBlock, reportUsage as hubReportUsage } from "../hub/hub.js";
import { loadConfig, type ClawConfig } from "../config/config.js";
import {
  clearLastError,
  createInitialState,
  isAgentChatCooldownActive,
  pushChat,
  pushOwnerMessage,
  setAgentChatCooldown,
  setLastError,
  setReceiveReplyDelay,
  syncMainDocumentForBlock,
  type ClawState,
} from "../state/state.js";
import { buildSystemContent, buildUserMessage } from "../prompts/prompts.js";
import type { ClawConfigPrompt } from "../prompts/prompts.js";
import type { Usage } from "../llm/usage.js";
import { runTickWithAiSdk, MUST_ACT_BUILD_TOOL_NAMES } from "../llm/toolsAi.js";
import { isDmChannel } from "../../util/dm.js";
import { createLlmProvider, type BuildIntentResult } from "../llm/provider.js";
import { executeTool } from "../tools/index.js";
import {
  movementDriverTick,
  MOVEMENT_INPUT_INTERVAL_MS,
} from "../movement/movementDriver.js";
import { AutonomousManager } from "../movement/autonomousManager.js";
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

/** Response from GET /api/agents/me: profile, soul, and default block (DB column default_space_id → API defaultBlock). */
type AgentBootstrapResponse = {
  hosted?: boolean;
  soul?: string | null;
  /** Current hub shape: default space from agent profile (default_space_id). */
  defaultBlock?: { blockId: string; serverUrl: string | null } | null;
  /** Legacy/alternate name for defaultBlock. */
  defaultSpace?: { blockId: string; serverUrl: string | null } | null;
  /** If hub exposes raw id only. */
  default_space_id?: string | null;
};

/** Resolve default block from bootstrap: profile default_space_id wins over BLOCK_ID env. */
function defaultBlockFromBootstrap(
  bootstrap: AgentBootstrapResponse | null | undefined
): { blockId: string; serverUrl: string | null } | null {
  if (!bootstrap) return null;
  const nested =
    bootstrap.defaultBlock ?? bootstrap.defaultSpace ?? null;
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
  /** "global" or dm:sessionA:sessionB. Use to filter or bucket by channel. */
  channelId?: string;
  /** When set (agent-to-agent broadcast), this message was directed at this session. */
  targetSessionId?: string;
};

/** Payload shape for WebSocket "error" messages. */
type ErrorPayload = { code?: string; error?: string; regionId?: string };

/**
 * Resolve engine URL and JWT: join existing block.
 * Profile default block (defaultBlock / default_space_id from GET /api/agents/me) takes precedence over BLOCK_ID env.
 */
async function getJwtAndEngineUrl(
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
    // Fallback when profile has no default space (local/dev only).
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
const BUILD_TOOLS = new Set([
  "generate_procedural",
  "build_full",
  "build_with_code",
  "build_incremental",
]);

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
    clearLastError(state);
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

  // DM wake but model returned no tool calls (common with Gemini) — send text as chat or minimal fallback.
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
    if (isAgentChatCooldownActive(state)) {
      state.pendingDmReply = { text, targetSessionId: peer };
    } else {
      client.sendChat(text, { targetSessionId: peer });
      state.lastAgentChatMessage = text;
      state.lastTickSentChat = true;
      state.lastToolRun = "chat";
      setAgentChatCooldown(state);
      client.sendSpeak(text);
      options.onTick?.(`dm fallback chat: ${text.slice(0, 60)}${text.length > 60 ? "…" : ""}`);
    }
  } else if (!result.hadToolCalls) {
    options.onTick?.("no tool calls");
  }

  // Engine error wake: model must summarize in chat — if it sent no tools, force a fallback message.
  if (
    state.errorReplyPending &&
    !result.hadToolCalls &&
    result.ok &&
    "replyText" in result
  ) {
    const text =
      result.replyText && result.replyText.trim().length > 0
        ? result.replyText.trim().slice(0, 500)
        : "Something went wrong on the server. If it keeps happening, try again in a moment.";
    const dmTarget = state.lastDmPeerSessionId;
    const blockedByCooldown = dmTarget != null && isAgentChatCooldownActive(state);
    if (blockedByCooldown && dmTarget) {
      state.pendingDmReply = { text, targetSessionId: dmTarget };
    } else if (!blockedByCooldown) {
      if (dmTarget) {
        client.sendChat(text, { targetSessionId: dmTarget });
        setAgentChatCooldown(state);
      } else {
        client.sendChat(text);
      }
      state.lastAgentChatMessage = text;
      state.lastTickSentChat = true;
      state.lastToolRun = "chat";
      client.sendSpeak(text);
      options.onTick?.(`error-reply fallback chat: ${text.slice(0, 60)}${text.length > 60 ? "…" : ""}`);
    }
  }

  // Once we've notified (or auto-fixed boundary), don't re-prompt the same error every tick
  if (state.lastError && state.lastTickSentChat) {
    clearLastError(state);
  }
  state.errorReplyPending = false;
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
    const resolved = await getJwtAndEngineUrl(config, bootstrap);
    jwt = resolved.jwt;
    engineUrl = resolved.engineUrl;
    blockId = resolved.blockId;
    blockSlotId = resolved.blockSlotId;
  } catch (e) {
    options.onDisconnect?.(e instanceof Error ? e : new Error(String(e)));
    throw e;
  }

  // So catalog/tools using config.blockId match the joined space (profile default_space_id may have been used instead of env).
  config.blockId = blockId;

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
    const p = payload as {
      regionId?: string;
      blockId?: string;
      sessionId?: string;
      voice?: { wsUrl: string; token: string };
    };
    const slot = typeof p.blockId === "string" ? p.blockId : p.regionId;
    if (typeof slot === "string") {
      state.blockSlotId = slot;
      blockSlotId = slot;
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
    /** DM from another participant — reply with targetSessionId = sender session. */
    const targetSessionId =
      typeof p.targetSessionId === "string" && p.targetSessionId.trim()
        ? p.targetSessionId.trim()
        : undefined;
    const directedAtMe = state.mySessionId && targetSessionId === state.mySessionId;
    const dmFromOther =
      state.mySessionId &&
      sessionId &&
      sessionId !== state.mySessionId &&
      (isDmChannel(p.channelId) || directedAtMe);
    const fromOwner = config.ownerUserId && userId === config.ownerUserId && message;
    if ((dmFromOther || directedAtMe) && sessionId) {
      state.lastDmPeerSessionId = sessionId;
      // Wait before we're allowed to reply — gives sender's TTS time to play so we don't talk over each other.
      setReceiveReplyDelay(state);
    } else if (p.channelId === "global") {
      state.lastDmPeerSessionId = null;
      state.pendingDmReply = null;
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
      clearLastError(state);
      state.lastDmPeerSessionId = null;
      syncMainDocumentForBlock(state);
    }
  });

  await client.connect();

  // --- Auto refresh hub JWT + HTTP session + WS (avoids expiry without pm2 restart) ---
  let sessionRefreshTimer: ReturnType<typeof setInterval> | null = null;
  if (config.sessionRefreshIntervalMs > 0 && blockId) {
    const refresh = (): void => {
      joinBlock(config.hubUrl, config.apiKey, blockId)
        .then((r) => {
          if (!r.ok) {
            clawLog("session refresh joinBlock failed", r.error);
            return;
          }
          jwt = r.jwt;
          if (r.serverUrl && r.serverUrl.trim()) engineUrl = r.serverUrl.trim();
          return client.getSessionToken().then(() => client.reconnectNow());
        })
        .then(() => clawDebug("session refresh ok (JWT + session + WS)"))
        .catch((e) => clawLog("session refresh error", e instanceof Error ? e.message : String(e)));
    };
    sessionRefreshTimer = setInterval(refresh, config.sessionRefreshIntervalMs);
    clawLog("session auto-refresh every", config.sessionRefreshIntervalMs, "ms");
  }

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

  // --- 50ms movement driver + autonomous (wander/emote when owner away) ---
  const autonomousManager = new AutonomousManager();
  const movementInterval = setInterval(() => {
    try {
      autonomousManager.tick(client, state, config);
      movementDriverTick(client, state);
      // Drain queued DM reply when receive delay has elapsed (turn-taking: don't talk over each other).
      const pending = state.pendingDmReply;
      if (pending && !isAgentChatCooldownActive(state)) {
        client.sendChat(pending.text, { targetSessionId: pending.targetSessionId });
        client.sendSpeak(pending.text);
        state.lastAgentChatMessage = pending.text;
        state.lastTickSentChat = true;
        setAgentChatCooldown(state);
        state.pendingDmReply = null;
      }
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
      if (sessionRefreshTimer) clearInterval(sessionRefreshTimer);
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
