/**
 * One tick of the tick loop: boundary handling, must_act_build phase, normal LLM tick, and fallbacks.
 * Driven by computeTickIntent + switch on intent kind. Each intent has a single handler.
 */

import type { DoppelClient } from "@doppelfun/sdk";
import { buildChatSendOptions } from "../chatSendOptions.js";
import {
  canSendDmTo,
  onWeSentDm,
} from "../conversation/index.js";
import type { ClawStore } from "../state/index.js";
import type { ClawState } from "../state/state.js";
import type { ClawConfig } from "../config/index.js";
import { buildUserMessage } from "../prompts/index.js";
import { runTickWithAiSdk, MUST_ACT_BUILD_TOOL_NAMES } from "../llm/toolsAi.js";
import { executeTool } from "../tools/index.js";
import { isOwnerNearby } from "../movement/index.js";
import { clawLog, clawDebug, truncatePreview } from "../log.js";
import type { ToolCallResult } from "./types.js";
import { reportChatUsageToHub } from "./usage.js";

/** Max ticks in must_act_build before forcing back to idle. */
const MUST_ACT_MAX_TICKS = 4;
/** Tool names that clear must_act_build when they succeed. */
const BUILD_TOOLS = new Set([
  "generate_procedural",
  "build_full",
  "build_with_code",
  "build_incremental",
]);

/** Prompt suffix when in must_act_build so the LLM only uses build tools. */
const MUST_ACT_BUILD_SUFFIX =
  "\n\n[Phase: must_act_build — chat is disabled until you run generate_procedural or build_full/build_incremental. Call one of those now; do not call chat.]";

/** Intent for one tick (after boundary is handled and lastTickToolNames cleared). */
export type TickIntent =
  | { kind: "build_procedural"; proceduralKind: "city" | "pyramid" }
  | { kind: "build_llm" }
  | { kind: "idle_skip" }
  | { kind: "llm_tick"; soulTick?: boolean };

/**
 * Compute what to do this tick from current state. Call after boundary handling and,
 * when in must_act_build, after incrementing pendingBuildTicks.
 */
export function computeTickIntent(state: ClawState, config: ClawConfig): TickIntent {
  if (state.tickPhase === "must_act_build") {
    if (state.pendingBuildTicks > MUST_ACT_MAX_TICKS || ownerBuildBlocked(config, state)) {
      return { kind: "idle_skip" };
    }
    if (state.pendingBuildKind) {
      return { kind: "build_procedural", proceduralKind: state.pendingBuildKind };
    }
    return { kind: "build_llm" };
  }

  // Idle phase: run LLM only if woken (DM/owner/error) or soul tick. If owner is nearby, don't treat soul as wake.
  let soulTick = state.autonomousSoulTickDue;
  if (soulTick && config.ownerUserId && state.myPosition && isOwnerNearby(state, config)) {
    soulTick = false;
  }
  if (!state.llmWakePending && !state.lastError && !soulTick) {
    return { kind: "idle_skip" };
  }

  return { kind: "llm_tick", soulTick: soulTick ?? undefined };
}

/**
 * True when hosted and owner gate blocks build (only owner can trigger build phase).
 *
 * @param config - Claw config (hosted, ownerUserId).
 * @param state - State (lastTriggerUserId).
 * @returns True when build is blocked because last trigger was not the owner.
 */
export function ownerBuildBlocked(config: ClawConfig, state: ClawState): boolean {
  return (
    config.hosted &&
    Boolean(config.ownerUserId) &&
    state.lastTriggerUserId !== config.ownerUserId
  );
}

/**
 * Send a DM and update conversation state (used by fallbacks and 50ms drain).
 * Exported for agent.ts movement interval.
 *
 * @param client - Doppel client (sendChat).
 * @param store - Claw store (updates via actions).
 * @param text - Message text to send.
 * @param targetSessionId - DM target session.
 * @param voiceId - Optional TTS voice id (e.g. config.voiceId from CLAW_VOICE_ID).
 */
export function sendDmAndTransition(
  client: DoppelClient,
  store: ClawStore,
  text: string,
  targetSessionId: string,
  voiceId?: string | null
): void {
  client.sendChat(text, buildChatSendOptions({ targetSessionId, voiceId }));
  store.setLastAgentChatMessage(text);
  store.setLastTickSentChat(true);
  onWeSentDm(store, targetSessionId);
}

/**
 * Callbacks passed to runTick for logging and tool result reporting.
 */
export type RunTickOptions = {
  onTick?: (summary: string) => void;
  onToolCallResult?: (name: string, args: string, result: ToolCallResult) => void;
};

/** Context passed to every tick intent handler (client, store, config, options, onToolResult). */
type TickContext = {
  client: DoppelClient;
  store: ClawStore;
  config: ClawConfig;
  systemContent: string;
  options: RunTickOptions;
  onToolResult: (name: string, args: string, result: ToolCallResult) => void;
};

/**
 * Send a fallback reply (DM or global). If dmTarget is set but we can't send yet (e.g. receive delay),
 * queue to pendingDmReply for the 50ms loop to drain. Otherwise send now and optionally log.
 */
function sendFallbackReply(
  ctx: TickContext,
  text: string,
  dmTarget: string | null,
  logLabel?: string
): void {
  const blocked = dmTarget != null && !canSendDmTo(ctx.store, dmTarget);
  if (blocked && dmTarget) {
    ctx.store.setState({ pendingDmReply: { text, targetSessionId: dmTarget } });
    return;
  }
  if (dmTarget) {
    sendDmAndTransition(ctx.client, ctx.store, text, dmTarget, ctx.config.voiceId);
  } else {
    ctx.client.sendChat(text, buildChatSendOptions({ voiceId: ctx.config.voiceId }));
    ctx.store.setLastAgentChatMessage(text);
    ctx.store.setLastTickSentChat(true);
  }
  ctx.store.setLastToolRun("chat");
  if (logLabel) ctx.options.onTick?.(logLabel);
}

/** Idle skip: clear must_act_build if we're escaping from it, then clear tool names. */
async function handleIdleSkip(ctx: TickContext): Promise<void> {
  const state = ctx.store.getState();
  if (state.tickPhase === "must_act_build") {
    ctx.store.clearMustActBuild();
    ctx.options.onTick?.("must_act_build: timeout or blocked, returning to idle");
  }
  ctx.store.setLastTickToolNames(null);
}

/** Build phase: run generate_procedural deterministically (no LLM) for city/pyramid. */
async function handleBuildProcedural(
  ctx: TickContext,
  proceduralKind: "city" | "pyramid"
): Promise<void> {
  const execResult = await executeTool(ctx.client, ctx.store, ctx.config, {
    name: "generate_procedural",
    args: { kind: proceduralKind },
  });
  ctx.onToolResult("generate_procedural", JSON.stringify({ kind: proceduralKind }), execResult);
  if (!execResult.ok) {
    ctx.options.onTick?.(`deterministic generate_procedural failed: ${execResult.error}`);
    ctx.store.setPendingBuildKind(null);
  }
  ctx.store.setLastTickToolNames(null);
}

/** Build phase: LLM with build-only tools (no chat). Used when pendingBuildKind is unset. */
async function handleBuildLlm(ctx: TickContext): Promise<void> {
  const userContent = buildUserMessage(ctx.store, ctx.config) + MUST_ACT_BUILD_SUFFIX;
  const result = await runTickWithAiSdk(
    ctx.client,
    ctx.store,
    ctx.config,
    ctx.systemContent,
    userContent,
    ctx.onToolResult,
    { omitChat: true, allowOnlyTools: MUST_ACT_BUILD_TOOL_NAMES }
  );
  if (!result.ok) ctx.options.onTick?.(`LLM error: ${result.error}`);
  else if (ctx.config.hosted) reportChatUsageToHub(ctx.config, result.usage, ctx.options.onTick);
  if (result.ok && !result.hadToolCalls) ctx.options.onTick?.("must_act_build: no tool calls");
  ctx.store.setLastTickToolNames(null);
}

/**
 * Normal LLM tick: build user message, run LLM with tools, then apply DM/error fallbacks
 * if the model didn't call tools but we owed a reply. Clears wake flags and lastError when done.
 */
async function handleLlmTick(ctx: TickContext, soulTick: boolean): Promise<void> {
  if (soulTick) ctx.store.setAutonomousSoulTickDue(false);
  const userContent = buildUserMessage(ctx.store, ctx.config);
  const result = await runTickWithAiSdk(
    ctx.client,
    ctx.store,
    ctx.config,
    ctx.systemContent,
    userContent,
    ctx.onToolResult
  );

  ctx.store.setLlmWakePending(false);

  if (!result.ok) {
    ctx.options.onTick?.(`LLM error: ${result.error}`);
    ctx.store.setDmReplyPending(false);
    ctx.store.setLastTickToolNames(null);
    return;
  }

  if (ctx.config.hosted) reportChatUsageToHub(ctx.config, result.usage, ctx.options.onTick);

  const state = ctx.store.getState();
  const replyText = "replyText" in result ? (result.replyText ?? "") : "";

  // DM fallback: we owed a DM reply but the model returned no tool calls (e.g. text-only).
  if (state.dmReplyPending && !result.hadToolCalls && state.lastDmPeerSessionId) {
    const text = replyText.length > 0 ? replyText : "Hey — I'm here.";
    sendFallbackReply(
      ctx,
      text,
      state.lastDmPeerSessionId,
      `dm fallback chat: ${truncatePreview(text)}`
    );
  } else if (!result.hadToolCalls) {
    ctx.options.onTick?.("no tool calls");
  }

  // Error fallback: summarize lastError in plain language and send (DM or global).
  if (state.errorReplyPending && !result.hadToolCalls) {
    const text =
      replyText.trim().length > 0
        ? replyText.trim().slice(0, 500)
        : "Something went wrong on the server. If it keeps happening, try again in a moment.";
    sendFallbackReply(
      ctx,
      text,
      state.lastDmPeerSessionId ?? null,
      `error-reply fallback chat: ${truncatePreview(text)}`
    );
  }

  if (ctx.store.getState().lastError && ctx.store.getState().lastTickSentChat) {
    ctx.store.clearLastError();
  }
  ctx.store.setErrorReplyPending(false);
  ctx.store.setDmReplyPending(false);
  ctx.store.setLastTickToolNames(null);
}

/**
 * Run one tick: optional boundary auto-join, then intent-based handlers (build procedural/LLM, idle skip, LLM tick with fallbacks).
 *
 * @param client - Doppel client (sendJoin, sendChat, etc.).
 * @param store - Claw store (reads via getState(), writes via actions/setState).
 * @param config - Claw config.
 * @param systemContent - Built system prompt for the LLM.
 * @param options - onTick and onToolCallResult callbacks.
 */
export async function runTick(
  client: DoppelClient,
  store: ClawStore,
  config: ClawConfig,
  systemContent: string,
  options: RunTickOptions
): Promise<void> {
  let state = store.getState();
  const tickParts = ["phase=" + state.tickPhase];
  if (state.pendingBuildKind) tickParts.push("pendingBuild=" + state.pendingBuildKind);
  if (state.tickPhase === "must_act_build")
    tickParts.push("buildTicks=" + state.pendingBuildTicks);
  clawLog("tick", ...tickParts);

  // Boundary: join and clear so rest of tick sees clean state.
  const boundarySlot = state.lastError?.blockSlotId;
  if (state.lastError?.code === "region_boundary" && boundarySlot) {
    client.sendJoin(boundarySlot);
    store.setBlockSlotId(boundarySlot);
    store.clearLastError();
    options.onTick?.(`join_block: ${store.getState().blockSlotId} (auto from boundary)`);
    return;
  }

  store.setLastTickToolNames([]);
  const onToolResult = (name: string, args: string, execResult: ToolCallResult) => {
    store.pushLastTickToolName(name);
    options.onToolCallResult?.(name, args, execResult);
    options.onTick?.(`${name}: ${execResult.ok ? execResult.summary ?? "ok" : execResult.error}`);
    store.setLastToolRun(name);
    if (execResult.ok && BUILD_TOOLS.has(name)) {
      store.clearMustActBuild();
    }
  };

  state = store.getState();
  if (state.tickPhase === "must_act_build") {
    store.setPendingBuildTicks(state.pendingBuildTicks + 1);
    state = store.getState();
  }

  const intent = computeTickIntent(state, config);
  const ctx: TickContext = {
    client,
    store,
    config,
    systemContent,
    options,
    onToolResult,
  };

  switch (intent.kind) {
    case "idle_skip":
      clawDebug("tick skip idle (no wake — LLM runs again on DM/owner message or error)");
      await handleIdleSkip(ctx);
      return;
    case "build_procedural":
      await handleBuildProcedural(ctx, intent.proceduralKind);
      return;
    case "build_llm":
      await handleBuildLlm(ctx);
      return;
    case "llm_tick":
      await handleLlmTick(ctx, intent.soulTick ?? false);
      return;
  }
}
