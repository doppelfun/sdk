/**
 * One tick of the agent loop: boundary handling, must_act_build phase, normal LLM tick, and fallbacks.
 */

import type { DoppelClient } from "@doppelfun/sdk";
import { buildChatSendOptions } from "../chatSendOptions.js";
import {
  canSendDmTo,
  onWeSentDm,
} from "../conversation/index.js";
import { clearLastError, type ClawState } from "../state/state.js";
import type { ClawConfig } from "../config/config.js";
import { buildUserMessage } from "../prompts/prompts.js";
import { runTickWithAiSdk, MUST_ACT_BUILD_TOOL_NAMES } from "../llm/toolsAi.js";
import { executeTool } from "../tools/index.js";
import { isOwnerNearby } from "../movement/ownerProximity.js";
import { clawLog, clawDebug } from "../log.js";
import type { ToolCallResult } from "./types.js";
import { reportChatUsageToHub } from "./usage.js";

const MUST_ACT_MAX_TICKS = 4;
const BUILD_TOOLS = new Set([
  "generate_procedural",
  "build_full",
  "build_with_code",
  "build_incremental",
]);

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
 * Clear must_act_build phase: back to idle, clear pending build kind and tick count.
 *
 * @param state - Claw state to mutate.
 */
export function clearMustActBuild(state: ClawState): void {
  state.tickPhase = "idle";
  state.pendingBuildKind = null;
  state.pendingBuildTicks = 0;
}

/**
 * Send a DM and update conversation state (used by fallbacks and 50ms drain).
 * Exported for agent.ts movement interval.
 *
 * @param client - Doppel client (sendChat).
 * @param state - Claw state to mutate (lastAgentChatMessage, lastTickSentChat, onWeSentDm).
 * @param text - Message text to send.
 * @param targetSessionId - DM target session.
 * @param voiceId - Optional TTS voice id (e.g. config.voiceId from CLAW_VOICE_ID).
 */
export function sendDmAndTransition(
  client: DoppelClient,
  state: ClawState,
  text: string,
  targetSessionId: string,
  voiceId?: string | null
): void {
  client.sendChat(text, buildChatSendOptions({ targetSessionId, voiceId }));
  state.lastAgentChatMessage = text;
  state.lastTickSentChat = true;
  onWeSentDm(state, targetSessionId);
}

/**
 * Callbacks passed to runTick for logging and tool result reporting.
 */
export type RunTickOptions = {
  onTick?: (summary: string) => void;
  onToolCallResult?: (name: string, args: string, result: ToolCallResult) => void;
};

/**
 * Run one tick: optional boundary auto-join, must_act_build phase (procedural or build-only LLM),
 * or normal LLM tick with DM/error fallbacks.
 *
 * @param client - Doppel client (sendJoin, sendChat, etc.).
 * @param state - Claw state (mutated).
 * @param config - Claw config.
 * @param systemContent - Built system prompt for the LLM.
 * @param options - onTick and onToolCallResult callbacks.
 */
export async function runTick(
  client: DoppelClient,
  state: ClawState,
  config: ClawConfig,
  systemContent: string,
  options: RunTickOptions
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

  if (state.tickPhase === "must_act_build") {
    state.pendingBuildTicks += 1;
    if (state.pendingBuildTicks > MUST_ACT_MAX_TICKS) {
      options.onTick?.("must_act_build: timeout, returning to idle");
      clearMustActBuild(state);
    } else if (ownerBuildBlocked(config, state)) {
      options.onTick?.("must_act_build: owner gate blocks build, clearing phase");
      clearMustActBuild(state);
    } else if (state.pendingBuildKind) {
      const kind = state.pendingBuildKind;
      const execResult = await executeTool(client, state, config, {
        name: "generate_procedural",
        args: { kind },
      });
      onToolResult("generate_procedural", JSON.stringify({ kind }), execResult);
      if (!execResult.ok) {
        options.onTick?.(`deterministic generate_procedural failed: ${execResult.error}`);
        state.pendingBuildKind = null;
      }
      state.lastTickToolNames = null;
      return;
    } else {
      const userContent =
        buildUserMessage(state, config) +
        "\n\n[Phase: must_act_build — chat is disabled until you run generate_procedural or build_full/build_incremental. Call one of those now; do not call chat.]";
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
  const result = await runTickWithAiSdk(
    client,
    state,
    config,
    systemContent,
    userContent,
    onToolResult
  );

  state.llmWakePending = false;

  if (!result.ok) {
    options.onTick?.(`LLM error: ${result.error}`);
    state.dmReplyPending = false;
    state.lastTickToolNames = null;
    return;
  }

  if (config.hosted) reportChatUsageToHub(config, result.usage, options.onTick);

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
    if (peer && !canSendDmTo(state, peer)) {
      state.pendingDmReply = { text, targetSessionId: peer };
    } else if (peer) {
      sendDmAndTransition(client, state, text, peer, config.voiceId);
      state.lastToolRun = "chat";
      options.onTick?.(`dm fallback chat: ${text.slice(0, 60)}${text.length > 60 ? "…" : ""}`);
    }
  } else if (!result.hadToolCalls) {
    options.onTick?.("no tool calls");
  }

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
    const blocked = dmTarget != null && !canSendDmTo(state, dmTarget);
    if (blocked && dmTarget) {
      state.pendingDmReply = { text, targetSessionId: dmTarget };
    } else if (!blocked) {
      if (dmTarget) {
        sendDmAndTransition(client, state, text, dmTarget, config.voiceId);
      } else {
        client.sendChat(text, buildChatSendOptions({ voiceId: config.voiceId }));
        state.lastAgentChatMessage = text;
        state.lastTickSentChat = true;
      }
      state.lastToolRun = "chat";
      options.onTick?.(`error-reply fallback chat: ${text.slice(0, 60)}${text.length > 60 ? "…" : ""}`);
    }
  }

  if (state.lastError && state.lastTickSentChat) {
    clearLastError(state);
  }
  state.errorReplyPending = false;
  state.dmReplyPending = false;
  state.lastTickToolNames = null;
}
