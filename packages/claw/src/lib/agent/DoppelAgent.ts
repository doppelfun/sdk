/**
 * Agent lifecycle: bootstrap, connect, tick loop, and message handlers.
 * Hold one instance to run() and optionally stop() for cleanup.
 */

import WebSocket from "ws";
import { createClient } from "@doppelfun/sdk";
import type { DoppelClient } from "@doppelfun/sdk";
import { joinBlock } from "../hub/index.js";
import { loadConfig, type ClawConfig } from "../config/index.js";
import { createClawStore, type ClawStore } from "../state/index.js";
import { clearConversation, onWeReceivedDm } from "../conversation/index.js";
import { buildSystemContent, type ClawConfigPrompt } from "../prompts/index.js";
import { isDmChannel } from "../../util/dm.js";
import { createLlmProvider } from "../llm/index.js";
import { MOVEMENT_INPUT_INTERVAL_MS, AutonomousManager } from "../movement/index.js";
import { clawLog, clawDebug, clawVerbose } from "../log.js";
import { runTick, ownerBuildBlocked } from "./tickRunner.js";
import { looksLikeBuildRequest } from "../tools/shared/gate.js";
import { buildChatSendOptions } from "../chatSendOptions.js";
import { getNextTickDelay, createTickScheduler, type TickScheduler } from "./scheduling.js";
import { createFastTickHandlers } from "./fastTick.js";
import {
  fetchAgentBootstrap,
  fetchSkills,
  getJwtAndEngineUrl,
} from "./bootstrap.js";
import type {
  AgentRunOptions,
  ChatPayload,
  ErrorPayload,
} from "./types.js";

const OCCUPANTS_REFRESH_MS = 8000;

/**
 * One agent instance: run() starts the loop and connect; stop() clears timers and disconnects.
 */
export class DoppelAgent {
  private config!: ClawConfig;
  private client!: DoppelClient;
  private store!: ClawStore;
  private scheduler!: TickScheduler;
  private systemContent!: string;

  private jwt!: string;
  private engineUrl!: string;
  private blockId!: string;
  private blockSlotId!: string;

  private sessionRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private occupantsRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private movementInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Bootstrap, connect, wire handlers, and start tick + timers.
   * Resolves when connect() completes; rejects on bootstrap/join error.
   */
  async run(options: AgentRunOptions = {}): Promise<void> {
    this.config = loadConfig();

    let soul: string | null = null;
    let skills = "";
    let bootstrap: Record<string, unknown> = {};

    try {
      bootstrap = await fetchAgentBootstrap(this.config.agentApiUrl, this.config.apiKey);
      if (typeof (bootstrap as { hosted?: boolean }).hosted === "boolean")
        this.config.hosted = (bootstrap as { hosted: boolean }).hosted;
      if (this.config.hosted) options.onTick?.("hosted agent — credit deduction enabled");
      if ((bootstrap as { soul?: string | null }).soul !== undefined)
        soul = (bootstrap as { soul?: string | null }).soul ?? null;
    } catch (e) {
      options.onTick?.(`bootstrap (agent+soul) failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (options.soul !== undefined) soul = options.soul ?? null;
    if (options.skills !== undefined) {
      skills = options.skills ?? "";
    } else {
      const skillIds = options.skillIds ?? this.config.skillIds;
      if (skillIds.length > 0) {
        try {
          skills = await fetchSkills(
            this.config.agentApiUrl,
            this.config.apiKey,
            skillIds
          );
        } catch (e) {
          console.warn("[agent] Failed to fetch skills, using soul only:", e);
        }
      }
    }

    const clawConfigPrompt: ClawConfigPrompt = { soul, skills };
    this.systemContent = buildSystemContent(clawConfigPrompt);
    console.log("[agent] System prompt (on start):\n" + this.systemContent);

    try {
      const resolved = await getJwtAndEngineUrl(this.config, bootstrap);
      this.jwt = resolved.jwt;
      this.engineUrl = resolved.engineUrl;
      this.blockId = resolved.blockId;
      this.blockSlotId = resolved.blockSlotId;
    } catch (e) {
      options.onDisconnect?.(e instanceof Error ? e : new Error(String(e)));
      throw e;
    }

    this.config.blockId = this.blockId;

    const getJwt = () => this.jwt;
    this.client = createClient({
      engineUrl: this.engineUrl,
      getJwt,
      WebSocket: WebSocket as unknown as typeof globalThis.WebSocket,
      agentWsPath: "/connect",
    });

    this.store = createClawStore(this.blockSlotId);
    this.scheduler = createTickScheduler();

    const runTickThenScheduleNext = (): void => {
      if (this.scheduler.isTickRunning()) {
        clawDebug("tick skipped (already in progress)");
        return;
      }
      this.scheduler.setTickRunning(true);
      runTick(this.client, this.store, this.config, this.systemContent, {
        onTick: options.onTick,
        onToolCallResult: options.onToolCallResult,
      })
        .catch((e) => {
          options.onTick?.(`tick error: ${e instanceof Error ? e.message : String(e)}`);
        })
        .finally(() => {
          this.scheduler.setTickRunning(false);
          const needImmediateFollowUp = this.scheduler.consumeFollowUp();
          const result = getNextTickDelay(this.store.getState(), this.config, {
            needImmediateFollowUp,
          });
          if (result.setSoulTickDue) {
            this.store.setAutonomousSoulTickDue(true);
            clawDebug("next soul tick in", result.delayMs, "ms (owner away)");
          }
          if (result.delayMs != null) {
            clawDebug("next tick in", result.delayMs, "ms");
            this.scheduler.scheduleNextTick(result.delayMs);
          } else {
            clawDebug("idle — no LLM tick scheduled (NPC-style; wake on DM/owner)");
          }
        });
    };

    this.scheduler.setTickCallback(runTickThenScheduleNext);

    const requestWakeTick = this.createRequestWakeTick(options, runTickThenScheduleNext);

    this.client.onMessage("authenticated", async (payload: unknown) => {
      const p = payload as {
        regionId?: string;
        blockId?: string;
        sessionId?: string;
        voice?: { wsUrl: string; token: string };
      };
      const slot = typeof p.blockId === "string" ? p.blockId : p.regionId;
      if (typeof slot === "string") {
        this.store.setBlockSlotId(slot);
        this.blockSlotId = slot;
        this.store.syncMainDocumentForBlock();
      }
      if (typeof p.sessionId === "string") this.store.setMySessionId(p.sessionId);
      options.onConnected?.(this.store.getState().blockSlotId, this.engineUrl);
    });

    this.client.onMessage("chat", (payload: unknown) => {
      const p = payload as ChatPayload;
      const state = this.store.getState();
      if (state.mySessionId && p.sessionId === state.mySessionId) return;
      const username = typeof p.username === "string" ? p.username : "?";
      const message =
        typeof p.message === "string" ? p.message : typeof p.text === "string" ? p.text : "";
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
      const fromOwner = this.config.ownerUserId && userId === this.config.ownerUserId && message;
      if (fromOwner) {
        clearConversation(this.store);
      } else if ((dmFromOther || directedAtMe) && sessionId) {
        const audioDurationMs =
          typeof (p as { audioDurationMs?: number }).audioDurationMs === "number"
            ? (p as { audioDurationMs: number }).audioDurationMs
            : undefined;
        onWeReceivedDm(this.store, sessionId, { audioDurationMs, messageLength: message.length });
      } else if (p.channelId === "global") {
        clearConversation(this.store);
      }
      const shouldWake = fromOwner || dmFromOther;
      if (shouldWake) {
        this.store.setLastAgentChatMessage(null);
        this.store.setLastTickSentChat(false);
        if (userId) this.store.setLastTriggerUserId(userId);
      }
      this.store.pushChat(
        {
          username,
          message,
          createdAt,
          userId,
          sessionId,
          channelId: typeof p.channelId === "string" ? p.channelId : undefined,
        },
        this.config.maxChatContext
      );
      if (fromOwner) {
        this.store.pushOwnerMessage(message, this.config.maxOwnerMessages);
      }
      if (shouldWake && message.trim()) {
        const reason = dmFromOther ? "dm" : "owner";
        clawLog("chat wake", reason, "from=" + username, "channel=" + (p.channelId ?? "?"));
        if (clawVerbose()) clawDebug("message preview:", message.trim().slice(0, 200));
        requestWakeTick(reason, message.trim());
      }
    });

    this.client.onMessage("error", (payload: unknown) => {
      const p = payload as ErrorPayload;
      const code = typeof p.code === "string" ? p.code : "error";
      const message = typeof p.error === "string" ? p.error : "Unknown error";
      const slot = typeof p.regionId === "string" ? p.regionId : undefined;
      this.store.setLastError(code, message, slot);
    });

    this.client.onMessage("joined", (payload: unknown) => {
      const p = payload as { regionId?: string };
      if (typeof p.regionId === "string") {
        this.store.setBlockSlotId(p.regionId);
        this.store.clearLastError();
        clearConversation(this.store, { skipSeekCooldown: true });
        this.store.syncMainDocumentForBlock();
      }
    });

    this.client.onMessage("waypoints", (payload: unknown) => {
      const p = payload as { waypoints?: { x: number; z: number }[] };
      this.store.setMovementWaypoints(Array.isArray(p?.waypoints) ? p.waypoints : null);
    });

    await this.client.connect();

    if (this.config.sessionRefreshIntervalMs > 0 && this.blockId) {
      const refresh = (): void => {
        joinBlock(this.config.hubUrl, this.config.apiKey, this.blockId)
          .then((r) => {
            if (!r.ok) {
              clawLog("session refresh joinBlock failed", r.error);
              return;
            }
            this.jwt = r.jwt;
            if (r.serverUrl && r.serverUrl.trim()) this.engineUrl = r.serverUrl.trim();
            return this.client.getSessionToken().then(() => this.client.reconnectNow());
          })
          .then(() => clawDebug("session refresh ok (JWT + session + WS)"))
          .catch((e) =>
            clawLog("session refresh error", e instanceof Error ? e.message : String(e))
          );
      };
      this.sessionRefreshTimer = setInterval(refresh, this.config.sessionRefreshIntervalMs);
      clawLog("session auto-refresh every", this.config.sessionRefreshIntervalMs, "ms");
    }

    if (this.config.ownerUserId) {
      this.occupantsRefreshTimer = setInterval(() => {
        if (this.scheduler.isTickRunning()) return;
        this.client
          .getOccupants()
          .then((list) => {
            const state = this.store.getState();
            this.store.setOccupants(list, state.mySessionId);
          })
          .catch(() => {});
      }, OCCUPANTS_REFRESH_MS);
    }

    const autonomousManager = new AutonomousManager();
    const fastTickHandlers = createFastTickHandlers(autonomousManager);
    this.movementInterval = setInterval(() => {
      try {
        const now = Date.now();
        const ctx = { client: this.client, store: this.store, config: this.config, now };
        for (const h of fastTickHandlers) {
          h(ctx);
        }
      } catch {
        // ignore
      }
    }, MOVEMENT_INPUT_INTERVAL_MS);

    const clientAny = this.client as unknown as { close?: () => void };
    if (typeof clientAny.close === "function") {
      const orig = clientAny.close.bind(this.client);
      clientAny.close = () => {
        this.cleanup();
        orig();
      };
    }

    const firstDelay = this.config.npcStyleIdle ? 0 : this.config.tickIntervalMs;
    this.scheduler.scheduleNextTick(firstDelay);
  }

  /**
   * Clear all timers and cancel the next tick; then disconnect the client.
   * Safe to call multiple times.
   */
  stop(): void {
    this.cleanup();
    const clientAny = this.client as unknown as { disconnect?: () => void };
    if (typeof clientAny.disconnect === "function") {
      clientAny.disconnect();
    }
  }

  private cleanup(): void {
    if (this.sessionRefreshTimer != null) {
      clearInterval(this.sessionRefreshTimer);
      this.sessionRefreshTimer = null;
    }
    if (this.occupantsRefreshTimer != null) {
      clearInterval(this.occupantsRefreshTimer);
      this.occupantsRefreshTimer = null;
    }
    if (this.movementInterval != null) {
      clearInterval(this.movementInterval);
      this.movementInterval = null;
    }
    if (this.scheduler) {
      this.scheduler.cancelNextTick();
    }
  }

  private createRequestWakeTick(
    options: AgentRunOptions,
    runTickThenScheduleNext: () => void
  ): (reason: string, wakeMessage?: string) => void {
    let wakeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    return (reason: string, wakeMessage?: string): void => {
      this.store.setLlmWakePending(true);
      if (reason === "dm") this.store.setDmReplyPending(true);
      if (this.scheduler.isTickRunning()) {
        this.scheduler.requestFollowUp();
        options.onTick?.(`wake after tick (${reason})`);
        return;
      }
      if (wakeDebounceTimer) clearTimeout(wakeDebounceTimer);
      const debounceMs = this.config.wakeTickDebounceMs;
      const msg = wakeMessage?.trim() ?? "";
      wakeDebounceTimer = setTimeout(() => {
        wakeDebounceTimer = null;
        if (this.scheduler.isTickRunning()) {
          this.scheduler.requestFollowUp();
          return;
        }
        this.scheduler.cancelNextTick();
        options.onTick?.(`wake tick (${reason})`);
        void (async () => {
          const state = this.store.getState();
          const blocked = ownerBuildBlocked(this.config, state);
          // When a non-owner asks to build, fail fast (no LLM) and tell them only the owner can trigger builds.
          if (msg && blocked && looksLikeBuildRequest(msg)) {
            const lastEntry = state.chat.length > 0 ? state.chat[state.chat.length - 1] : undefined;
            const targetSessionId = lastEntry?.sessionId?.trim();
            const reply = "Only the owner can ask me to build.";
            this.client.sendChat(reply, buildChatSendOptions({ targetSessionId }) ?? undefined);
            this.store.setLlmWakePending(false);
            this.store.setDmReplyPending(false);
            clawLog("agent", "build request from non-owner — replied without LLM");
            return;
          }
          if (msg && !blocked) {
            try {
              this.client.sendThinking(true);
              let intent;
              try {
                intent = await createLlmProvider(this.config).classifyBuildIntent(
                  msg,
                  this.config.buildLlmModel
                );
              } finally {
                this.client.sendThinking(false);
              }
              if (intent.requiresBuildAction) {
                this.store.setTickPhase("must_act_build");
                this.store.setPendingBuildKind(intent.proceduralKind);
                this.store.setPendingBuildTicks(0);
                this.store.setLastTickSentChat(false);
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
}
