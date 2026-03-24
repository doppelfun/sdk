/**
 * Chat tool handler: send global chat or DM, queue reply with turn-taking, report voice usage.
 */
import type { ToolContext } from "../types.js";
import { buildChatSendOptions } from "../../util/chatSendOptions.js";
import { evaluateSendReply, onWeSentDm } from "../../lib/conversation.js";
import { isOwnerNearby } from "../../lib/movement/index.js";
import { isTargetOwner, isOccupantNearby } from "../../util/position.js";
import { reportVoiceUsageToHub } from "../../lib/credits/index.js";
import { clawLog } from "../../util/log.js";

/**
 * Handle chat tool: validate text, resolve targetSessionId (DM vs global), send or queue reply.
 *
 * @param ctx - Tool context (client, store, config, args: text, targetSessionId?, voiceId?)
 * @returns ExecuteToolResult
 */
export async function handleChat(ctx: ToolContext) {
  const { client, store, args, config, logAction } = ctx;
  const state = store.getState();
  const text = typeof args.text === "string" ? args.text.slice(0, 500).trim() : "";
  let targetSessionId: string | null =
    typeof args.targetSessionId === "string" ? args.targetSessionId.trim() || null : null;
  // Enforce DM when we have a peer in state (e.g. user just DMed us): reply to that session, not global
  if (text && state.lastDmPeerSessionId) {
    targetSessionId = targetSessionId ?? state.lastDmPeerSessionId;
  }

  const autonomous =
    (config.ownerUserId && state.myPosition && !isOwnerNearby(state, config)) || !config.ownerUserId;
  if (text && !targetSessionId && autonomous) {
    return {
      ok: false,
      error:
        "You must send a DM only. Call chat with targetSessionId set to the person you're talking to.",
    };
  }

  if (text && targetSessionId && state.mySessionId && targetSessionId === state.mySessionId) {
    return {
      ok: false,
      error: "You cannot send a DM to yourself. Use targetSessionId from get_occupants for another person.",
    };
  }

  if (text && targetSessionId) {
    if (!isTargetOwner(state.occupants, targetSessionId, config.ownerUserId)) {
      if (!state.myPosition) {
        return {
          ok: false,
          error:
            "You need to be in the space to DM someone. Move first or use get_occupants to see who's here.",
        };
      }
      if (!isOccupantNearby(state.occupants, state.myPosition, targetSessionId, config.chatNearbyRadiusM)) {
        return {
          ok: false,
          error:
            "That person is too far away. Use approach_person or follow to get closer first.",
        };
      }
    }
  }

  if (text && targetSessionId) {
    const action = evaluateSendReply(store, targetSessionId, text);
    if (action.action === "queue") {
      // Mark chat handled so the runner does not send a "..." fallback while the real line is pending in drain.
      store.setState({ pendingDmReply: action.pendingDmReply, lastTickSentChat: true });
      return { ok: true as const, summary: "queued (reply after turn-taking delay)" };
    }
  }

  if (text) {
    const voiceId =
      (typeof args.voiceId === "string" ? args.voiceId.trim() : null) || config.voiceId || undefined;
    clawLog("chat tool: sendChat", targetSessionId ? "DM" : "global", text.slice(0, 50));
    client.sendChat(text, buildChatSendOptions({ targetSessionId: targetSessionId ?? undefined, voiceId }));
    if (voiceId) {
      reportVoiceUsageToHub(config, store, text.length);
    }
    store.setLastAgentChatMessage(text);
    store.setLastTickSentChat(true);
    store.clearOwnerMessages();
    if (targetSessionId) onWeSentDm(store, targetSessionId);
    else store.setState({ lastDmPeerSessionId: null });
  }
  logAction(text ? (targetSessionId ? "sent DM" : "sent chat") : "no text");
  return { ok: true as const, summary: targetSessionId ? "sent DM" : "sent chat" };
}
