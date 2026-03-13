/**
 * Agent loop: bootstrap, connect, tick scheduling, and WebSocket message handlers.
 * Tick logic lives in tickRunner; bootstrap in bootstrap; usage in usage.
 */

import WebSocket from "ws";
import { createClient } from "@doppelfun/sdk";
import { joinBlock } from "../hub/hub.js";
import { loadConfig, type ClawConfig } from "../config/config.js";
import {
  clearLastError,
  createInitialState,
  pushChat,
  pushOwnerMessage,
  setLastError,
  syncMainDocumentForBlock,
  type ClawState,
} from "../state/state.js";
import { clearConversation, onWeReceivedDm } from "../conversation/index.js";
import { buildSystemContent } from "../prompts/prompts.js";
import type { ClawConfigPrompt } from "../prompts/prompts.js";
import { isDmChannel } from "../../util/dm.js";
import { createLlmProvider } from "../llm/provider.js";
import {
  movementDriverTick,
  MOVEMENT_INPUT_INTERVAL_MS,
} from "../movement/movementDriver.js";
import { AutonomousManager } from "../movement/autonomousManager.js";
import { isOwnerNearby } from "../movement/ownerProximity.js";
import { clawLog, clawDebug, clawVerbose } from "../log.js";
import { checkBreak, CONVERSATION_MAX_ROUNDS, drainPendingReply } from "../conversation/index.js";
import { runTick, ownerBuildBlocked, sendDmAndTransition } from "./tickRunner.js";
import {
  fetchAgentBootstrap,
  fetchSkills,
  getJwtAndEngineUrl,
} from "./bootstrap.js";
import type {
  AgentRunOptions,
  ToolCallResult,
  ChatPayload,
  ErrorPayload,
} from "./types.js";

export type { ToolCallResult, AgentRunOptions } from "./types.js";

/**
 * Create a debounced wake-tick request function.
 * Schedules a tick soon after chat that should trigger a reply (DM or owner).
 * If a tick is already running, sets wakeAfterTick so the next tick runs immediately after.
 * Optionally classifies build intent from the message and sets must_act_build phase.
 *
 * @param client - Doppel client (sendThinking, etc.).
 * @param state - Claw state (mutated: llmWakePending, dmReplyPending, tickPhase, etc.).
 * @param config - Claw config (wakeTickDebounceMs, buildLlmModel).
 * @param options - Agent run options (onTick callback).
 * @param tickInProgress - Ref whose .current is true while a tick is running.
 * @param wakeAfterTick - Ref to set to true when we want a follow-up tick after current one finishes.
 * @param tickScheduled - Ref holding the scheduled timeout id so we can clear it.
 * @param runTickThenScheduleNext - Function to run one tick and then schedule the next.
 * @returns A function requestWakeTick(reason, wakeMessage?) to call when chat should wake the agent.
 */
function createRequestWakeTick(
  client: ReturnType<typeof createClient>,
  state: ClawState,
  config: ClawConfig,
  options: AgentRunOptions,
  tickInProgress: { current: boolean },
  wakeAfterTick: { current: boolean },
  tickScheduled: { current: ReturnType<typeof setTimeout> | null },
  runTickThenScheduleNext: () => void
) {
  let wakeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  return function requestWakeTick(reason: string, wakeMessage?: string): void {
    state.llmWakePending = true;
    if (reason === "dm") state.dmReplyPending = true;
    if (tickInProgress.current) {
      wakeAfterTick.current = true;
      options.onTick?.(`wake after tick (${reason})`);
      return;
    }
    if (wakeDebounceTimer) clearTimeout(wakeDebounceTimer);
    const debounceMs = config.wakeTickDebounceMs;
    const msg = wakeMessage?.trim() ?? "";
    wakeDebounceTimer = setTimeout(() => {
      wakeDebounceTimer = null;
      if (tickInProgress.current) {
        wakeAfterTick.current = true;
        return;
      }
      if (tickScheduled.current) clearTimeout(tickScheduled.current);
      tickScheduled.current = null;
      options.onTick?.(`wake tick (${reason})`);
      void (async () => {
        if (msg && !ownerBuildBlocked(config, state)) {
          try {
            client.sendThinking(true);
            let intent;
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
}

/**
 * Start the agent: resolve JWT/engine, create client, connect, run tick loop.
 * Bootstrap (profile, soul, skills), joinBlock for JWT, then connect WebSocket and run
 * tick scheduling, message handlers, session refresh, and 50ms movement driver.
 * On disconnect the tick will fail; use onDisconnect to restart (e.g. pm2).
 *
 * @param options - Optional callbacks (onConnected, onDisconnect, onTick, onToolCallResult) and overrides (soul, skills, skillIds).
 * @returns Promise that resolves when connect() completes; rejects on bootstrap/join error.
 */
export async function runAgent(options: AgentRunOptions = {}): Promise<void> {
  const config = loadConfig();

  let soul: string | null = null;
  let skills = "";
  let bootstrap = {};

  try {
    bootstrap = await fetchAgentBootstrap(config.agentApiUrl, config.apiKey);
    if (typeof (bootstrap as { hosted?: boolean }).hosted === "boolean")
      config.hosted = (bootstrap as { hosted: boolean }).hosted;
    if (config.hosted) options.onTick?.("hosted agent — credit deduction enabled");
    if ((bootstrap as { soul?: string | null }).soul !== undefined)
      soul = (bootstrap as { soul?: string | null }).soul ?? null;
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

  config.blockId = blockId;

  const getJwt = () => jwt;
  const client = createClient({
    engineUrl,
    getJwt,
    WebSocket: WebSocket as unknown as typeof globalThis.WebSocket,
    agentWsPath: "/connect",
  });

  const state = createInitialState(blockSlotId);

  const tickScheduledRef = { current: null as ReturnType<typeof setTimeout> | null };
  const wakeAfterTickRef = { current: false };
  let tickInProgress = false;

  const runTickThenScheduleNext = (): void => {
    if (tickInProgress) {
      clawDebug("tick skipped (already in progress)");
      return;
    }
    tickInProgress = true;
    runTick(client, state, config, systemContent, {
      onTick: options.onTick,
      onToolCallResult: options.onToolCallResult,
    })
      .catch((e) => {
        options.onTick?.(`tick error: ${e instanceof Error ? e.message : String(e)}`);
      })
      .finally(() => {
        tickInProgress = false;
        const needImmediateFollowUp = wakeAfterTickRef.current;
        wakeAfterTickRef.current = false;
        if (tickScheduledRef.current) clearTimeout(tickScheduledRef.current);
        tickScheduledRef.current = null;

        let delayMs: number | null = null;
        if (needImmediateFollowUp) delayMs = 0;
        else if (state.tickPhase === "must_act_build") delayMs = 0;
        else if (state.lastError) delayMs = config.tickIntervalMs;
        else if (config.npcStyleIdle && !state.llmWakePending) {
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
          tickScheduledRef.current = setTimeout(runTickThenScheduleNext, delayMs);
        } else {
          clawDebug("idle — no LLM tick scheduled (NPC-style; wake on DM/owner)");
        }
      });
  };

  const tickInProgressRef = { get current() { return tickInProgress; } };
  const requestWakeTick = createRequestWakeTick(
    client,
    state,
    config,
    options,
    tickInProgressRef,
    wakeAfterTickRef,
    tickScheduledRef,
    runTickThenScheduleNext
  );

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
    if (fromOwner) {
      clearConversation(state);
    } else if ((dmFromOther || directedAtMe) && sessionId) {
      const audioDurationMs = typeof (p as { audioDurationMs?: number }).audioDurationMs === "number"
        ? (p as { audioDurationMs: number }).audioDurationMs
        : undefined;
      onWeReceivedDm(state, sessionId, { audioDurationMs, messageLength: message.length });
    } else if (p.channelId === "global") {
      clearConversation(state);
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
      clearConversation(state, { skipSeekCooldown: true });
      syncMainDocumentForBlock(state);
    }
  });

  await client.connect();

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

  const autonomousManager = new AutonomousManager();
  const movementInterval = setInterval(() => {
    try {
      checkBreak(state, Date.now(), {
        occupants: state.occupants,
        ownerUserId: config.ownerUserId,
        lastTriggerUserId: state.lastTriggerUserId,
        maxRounds: CONVERSATION_MAX_ROUNDS,
      });
      autonomousManager.tick(client, state, config);
      movementDriverTick(client, state, { voiceId: config.voiceId });
      const pending = drainPendingReply(state);
      if (pending) {
        sendDmAndTransition(client, state, pending.text, pending.targetSessionId, config.voiceId);
      }
    } catch {
      // ignore
    }
  }, MOVEMENT_INPUT_INTERVAL_MS);

  const clearMovementInterval = (): void => clearInterval(movementInterval);
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

  const firstDelay = config.npcStyleIdle ? 0 : config.tickIntervalMs;
  tickScheduledRef.current = setTimeout(runTickThenScheduleNext, firstDelay);
}
