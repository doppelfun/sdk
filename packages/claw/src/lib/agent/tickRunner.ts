/**
 * One tick of the tick loop: boundary handling, must_act_build phase, normal LLM tick, and fallbacks.
 * Driven by computeTickIntent + switch on intent kind. Each intent has a single handler.
 */

import type { DoppelClient } from "@doppelfun/sdk";
import { buildChatSendOptions } from "../chatSendOptions.js";
import { evaluateSendReply, onWeSentDm } from "../conversation/index.js";
import type { ClawStore } from "../state/index.js";
import type { ClawState } from "../state/state.js";
import type { ClawConfig } from "../config/index.js";
import { buildUserMessage } from "../prompts/index.js";
import { runClawAgentTick } from "./clawAgent.js";
import { MUST_ACT_BUILD_TOOL_NAMES } from "../llm/toolsAi.js";
import { getTickModelForMessage } from "../llm/modelRouter.js";
import { executeTool } from "../tools/index.js";
import { isOwnerNearby } from "../movement/index.js";
import { clawLog, clawDebug } from "../log.js";
import type { ToolCallResult } from "./types.js";
import { reportChatUsageToHub, recordUsageStub } from "./usage.js";
import { evaluateReplyAction } from "./workflow/index.js";

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
 * Workflow router: compute which step to run this tick from state and config.
 * Call after boundary handling and, when in must_act_build, after incrementing pendingBuildTicks.
 * @see docs/PLAN-WORKFLOW-PATTERNS.md Phase 1
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
 * Send a fallback reply (DM or global). Uses evaluateSendReply: queue for drain or send now.
 */
function sendFallbackReply(
  ctx: TickContext,
  text: string,
  dmTarget: string | null,
  logLabel?: string
): void {
  const action = evaluateSendReply(ctx.store, dmTarget, text);
  if (action.action === "queue") {
    ctx.store.setState({ pendingDmReply: action.pendingDmReply });
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
  ctx.store.setLlmWakePending(false);
  ctx.store.setLastTickToolNames(null);
}

/** Build phase: LLM with build-only tools (no chat). Used when pendingBuildKind is unset. */
async function handleBuildLlm(ctx: TickContext): Promise<void> {
  const userContent = buildUserMessage(ctx.store, ctx.config) + MUST_ACT_BUILD_SUFFIX;
  const result = await runClawAgentTick(
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
  if (result.ok && result.usage) recordUsageStub(result.usage);
  if (result.ok && !result.hadToolCalls) ctx.options.onTick?.("must_act_build: no tool calls");
  ctx.store.setLlmWakePending(false);
  ctx.store.setLastTickToolNames(null);
}

/**
 * Build workflow: run the chosen worker (procedural or build-only LLM).
 * Orchestrator (classify) runs in wake; here we only execute the selected worker.
 * @see docs/PLAN-WORKFLOW-PATTERNS.md Phase 4
 */
async function runBuildWorkflow(
  ctx: TickContext,
  intent: Extract<TickIntent, { kind: "build_procedural" } | { kind: "build_llm" }>
): Promise<void> {
  if (intent.kind === "build_procedural") {
    await handleBuildProcedural(ctx, intent.proceduralKind);
  } else {
    await handleBuildLlm(ctx);
  }
}

/**
 * LLM tick as a short chain: Act (build message + run agent) → Respond (evaluate reply + apply once).
 * When config.modelRouterEnabled (CLAW_MODEL_ROUTER=1), use a Flash classifier to pick Pro vs Flash for this tick.
 * @see docs/PLAN-WORKFLOW-PATTERNS.md Phase 2–3
 */
async function handleLlmTick(ctx: TickContext, soulTick: boolean): Promise<void> {
  if (soulTick) ctx.store.setAutonomousSoulTickDue(false);

  // —— Act step: build user message and run LLM with tools ——
  const userContent = buildUserMessage(ctx.store, ctx.config);
  const tickModel =
    ctx.config.modelRouterEnabled
      ? await getTickModelForMessage(ctx.config, userContent)
      : null;
  const result = await runClawAgentTick(
    ctx.client,
    ctx.store,
    ctx.config,
    ctx.systemContent,
    userContent,
    ctx.onToolResult,
    undefined,
    tickModel ?? undefined
  );

  ctx.store.setLlmWakePending(false);

  if (!result.ok) {
    ctx.options.onTick?.(`LLM error: ${result.error}`);
    ctx.store.setDmReplyPending(false);
    ctx.store.setLastTickToolNames(null);
    return;
  }

  if (ctx.config.hosted) reportChatUsageToHub(ctx.config, result.usage, ctx.options.onTick);
  if (result.usage) recordUsageStub(result.usage);

  // —— Respond step: evaluate whether we owe a reply, then apply once ——
  const state = ctx.store.getState();
  const llmResultForReply = {
    ok: true as const,
    hadToolCalls: result.hadToolCalls,
    replyText: "replyText" in result ? result.replyText : undefined,
  };
  const replyAction = evaluateReplyAction(state, llmResultForReply);

  if (replyAction.action === "send") {
    sendFallbackReply(
      ctx,
      replyAction.text,
      replyAction.targetSessionId ?? null,
      replyAction.logLabel
    );
  } else if (!result.hadToolCalls) {
    ctx.options.onTick?.("no tool calls");
  }

  if (ctx.store.getState().lastError && ctx.store.getState().lastTickSentChat) {
    ctx.store.clearLastError();
  }
  ctx.store.setErrorReplyPending(false);
  ctx.store.setDmReplyPending(false);
  ctx.store.setLastTickToolNames(null);
}

/**
 * Run one tick: optional boundary auto-join, then router (computeTickIntent) → step handlers
 * (build procedural/LLM, idle skip, LLM tick with reply evaluation).
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
    options.onTick?.(`${name}: ${execResult.ok ? execResult.summary ?? "ok" : execResult.error ?? "(no error message)"}`);
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
    case "build_llm":
      await runBuildWorkflow(ctx, intent);
      return;
    case "llm_tick":
      await handleLlmTick(ctx, intent.soulTick ?? false);
      return;
  }
}
