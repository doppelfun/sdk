/**
 * One tick of the agent loop: boundary handling, must_act_build phase, normal LLM tick, and fallbacks.
 */

import type { DoppelClient } from "@doppelfun/sdk";
import { buildChatSendOptions } from "../chatSendOptions.js";
import {
  canSendDmTo,
  onWeSentDm,
} from "../conversation/index.js";
import type { ClawStore } from "../state/index.js";
import type { ClawState } from "../state/state.js";
import type { ClawConfig } from "../config/config.js";
import { buildUserMessage } from "../prompts/prompts.js";
import { runTickWithAiSdk, MUST_ACT_BUILD_TOOL_NAMES } from "../llm/toolsAi.js";
import { executeTool } from "../tools/index.js";
import { isOwnerNearby } from "../movement/ownerProximity.js";
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

/**
 * Run one tick: optional boundary auto-join, must_act_build phase (procedural or build-only LLM),
 * or normal LLM tick with DM/error fallbacks.
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

  const boundarySlot = state.lastError?.blockSlotId;
  if (state.lastError?.code === "region_boundary" && boundarySlot) {
    client.sendJoin(boundarySlot);
    store.setBlockSlotId(boundarySlot);
    store.clearLastError();
    options.onTick?.(`join_block: ${store.getState().blockSlotId} (auto from boundary)`);
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
    if (state.pendingBuildTicks > MUST_ACT_MAX_TICKS) {
      options.onTick?.("must_act_build: timeout, returning to idle");
      store.clearMustActBuild();
    } else if (ownerBuildBlocked(config, state)) {
      options.onTick?.("must_act_build: owner gate blocks build, clearing phase");
      store.clearMustActBuild();
    } else if (state.pendingBuildKind) {
      const kind = state.pendingBuildKind;
      const execResult = await executeTool(client, store, config, {
        name: "generate_procedural",
        args: { kind },
      });
      onToolResult("generate_procedural", JSON.stringify({ kind }), execResult);
      if (!execResult.ok) {
        options.onTick?.(`deterministic generate_procedural failed: ${execResult.error}`);
        store.setPendingBuildKind(null);
      }
      store.setLastTickToolNames(null);
      return;
    } else {
      const userContent =
        buildUserMessage(store, config) +
        "\n\n[Phase: must_act_build — chat is disabled until you run generate_procedural or build_full/build_incremental. Call one of those now; do not call chat.]";
      const result = await runTickWithAiSdk(
        client,
        store,
        config,
        systemContent,
        userContent,
        onToolResult,
        { omitChat: true, allowOnlyTools: MUST_ACT_BUILD_TOOL_NAMES }
      );
      if (!result.ok) options.onTick?.(`LLM error: ${result.error}`);
      else if (config.hosted) reportChatUsageToHub(config, result.usage, options.onTick);
      if (result.ok && !result.hadToolCalls) options.onTick?.("must_act_build: no tool calls");
      store.setLastTickToolNames(null);
      return;
    }
  }

  state = store.getState();
  let soulTick = state.autonomousSoulTickDue;
  if (soulTick && config.ownerUserId && state.myPosition && isOwnerNearby(state, config)) {
    store.setAutonomousSoulTickDue(false);
    soulTick = false;
  }
  if (!state.llmWakePending && !state.lastError && !soulTick) {
    clawDebug("tick skip idle (no wake — LLM runs again on DM/owner message or error)");
    store.setLastTickToolNames(null);
    return;
  }

  const userContent = buildUserMessage(store, config);
  if (soulTick) store.setAutonomousSoulTickDue(false);
  const result = await runTickWithAiSdk(
    client,
    store,
    config,
    systemContent,
    userContent,
    onToolResult
  );

  store.setLlmWakePending(false);

  if (!result.ok) {
    options.onTick?.(`LLM error: ${result.error}`);
    store.setDmReplyPending(false);
    store.setLastTickToolNames(null);
    return;
  }

  if (config.hosted) reportChatUsageToHub(config, result.usage, options.onTick);

  state = store.getState();
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
    if (peer && !canSendDmTo(store, peer)) {
      store.setState({ pendingDmReply: { text, targetSessionId: peer } });
    } else if (peer) {
      sendDmAndTransition(client, store, text, peer, config.voiceId);
      store.setLastToolRun("chat");
      options.onTick?.(`dm fallback chat: ${truncatePreview(text)}`);
    }
  } else if (!result.hadToolCalls) {
    options.onTick?.("no tool calls");
  }

  state = store.getState();
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
    const blocked = dmTarget != null && !canSendDmTo(store, dmTarget);
    if (blocked && dmTarget) {
      store.setState({ pendingDmReply: { text, targetSessionId: dmTarget } });
    } else if (!blocked) {
      if (dmTarget) {
        sendDmAndTransition(client, store, text, dmTarget, config.voiceId);
      } else {
        client.sendChat(text, buildChatSendOptions({ voiceId: config.voiceId }));
        store.setLastAgentChatMessage(text);
        store.setLastTickSentChat(true);
      }
      store.setLastToolRun("chat");
      options.onTick?.(`error-reply fallback chat: ${truncatePreview(text)}`);
    }
  }

  state = store.getState();
  if (state.lastError && state.lastTickSentChat) {
    store.clearLastError();
  }
  store.setErrorReplyPending(false);
  store.setDmReplyPending(false);
  store.setLastTickToolNames(null);
}
