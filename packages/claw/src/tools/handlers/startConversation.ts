/**
 * start_conversation tool handler: set conversation target and optionally send an opening message.
 */
import type { ToolContext } from "../types.js";
import { buildChatSendOptions } from "../../util/chatSendOptions.js";
import { clearConversation, evaluateSendReply, onWeSentDm } from "../../lib/conversation.js";
import { reportVoiceUsageToHub } from "../../lib/credits/index.js";
import { clawLog } from "../../util/log.js";

/**
 * Handle start_conversation: set lastDmPeerSessionId so the next chat goes to the target;
 * if openingMessage is provided, send it as a DM (with turn-taking) and update conversation state.
 *
 * @param ctx - Tool context (client, store, config, args: targetSessionId, openingMessage?)
 * @returns ExecuteToolResult
 */
export async function handleStartConversation(ctx: ToolContext) {
  const { client, store, args, config, logAction } = ctx;
  const targetSessionId =
    typeof args.targetSessionId === "string" ? args.targetSessionId.trim() : null;
  if (!targetSessionId) {
    return { ok: false as const, error: "targetSessionId is required (use get_occupants to find session ids)." };
  }

  const state = store.getState();
  // If we're switching to a new peer while a conversation is in progress,
  // exit/reset the paced conversation FSM so we can start immediately.
  if (state.conversationPhase !== "idle" && state.conversationPeerSessionId !== targetSessionId) {
    clearConversation(store, { skipSeekCooldown: true });
  }

  const openingMessage =
    typeof args.openingMessage === "string" ? args.openingMessage.slice(0, 500).trim() : "";

  // Always set conversation target so subsequent chat() calls default to this peer
  store.setState({ lastDmPeerSessionId: targetSessionId });

  if (openingMessage) {
    const action = evaluateSendReply(store, targetSessionId, openingMessage);
    if (action.action === "queue") {
      store.setState({ pendingDmReply: action.pendingDmReply });
      logAction("start_conversation (opening queued)");
      return { ok: true as const, summary: "conversation target set; opening message queued (reply after turn-taking)" };
    }
    const voiceId = config.voiceId ?? undefined;
    clawLog("start_conversation: sendChat DM", openingMessage.slice(0, 50));
    client.sendChat(openingMessage, buildChatSendOptions({ targetSessionId, voiceId }));
    if (voiceId && config.voiceEnabled) {
      reportVoiceUsageToHub(config, store, openingMessage.length);
    }
    store.setLastAgentChatMessage(openingMessage);
    store.setLastTickSentChat(true);
    store.clearOwnerMessages();
    onWeSentDm(store, targetSessionId);
    logAction("start_conversation (opening sent)");
    return { ok: true as const, summary: "conversation started; opening message sent" };
  }

  logAction("start_conversation (target set)");
  return { ok: true as const, summary: "conversation target set; use chat to send a message" };
}
