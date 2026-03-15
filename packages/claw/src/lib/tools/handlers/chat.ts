import type { ToolContext } from "../types.js";
import { buildChatSendOptions } from "../../chatSendOptions.js";
import { evaluateSendReply, onWeSentDm } from "../../conversation/index.js";
import { truncatePreview } from "../../log.js";

export async function handleChat(ctx: ToolContext) {
  const { client, store, args, config, logAction } = ctx;
  const state = store.getState();
  const text = typeof args.text === "string" ? args.text.slice(0, 500).trim() : "";
  let targetSessionId: string | null =
    typeof args.targetSessionId === "string" ? args.targetSessionId.trim() || null : null;
  if (text && !targetSessionId && state.lastDmPeerSessionId) {
    targetSessionId = state.lastDmPeerSessionId;
  }

  // When in a conversation with another agent, only one message per turn — wait for their reply.
  // When DMing a human (user/owner), allow follow-up messages (e.g. "having trouble with the move command").
  if (text && state.lastTickSentChat) {
    const peerIsAgent =
      targetSessionId != null &&
      state.occupants.some((o) => o.clientId === targetSessionId && o.type === "agent");
    if (peerIsAgent) {
      return {
        ok: false,
        error: "Already sent a message this turn; wait for the other person to respond.",
      };
    }
  }

  // Evaluate send vs queue; conversation FSM so conversations aren’t spammed and voice can finish.
  if (text && targetSessionId) {
    const action = evaluateSendReply(store, targetSessionId, text);
    if (action.action === "queue") {
      store.setState({ pendingDmReply: action.pendingDmReply });
      return {
        ok: true,
        summary: "queued (reply will be sent after turn-taking delay)",
      };
    }
  }

  if (text) {
    const voiceId =
      (typeof args.voiceId === "string" ? args.voiceId.trim() : null) || config.voiceId || undefined;
    client.sendChat(text, buildChatSendOptions({ targetSessionId: targetSessionId ?? undefined, voiceId }));
    store.setLastAgentChatMessage(text);
    store.setLastTickSentChat(true);
    if (targetSessionId) {
      onWeSentDm(store, targetSessionId);
    } else {
      store.setState({ lastDmPeerSessionId: null });
    }
  }
  const summary = targetSessionId ? "sent DM" : "sent chat";
  if (text) logAction(`${summary}: ${truncatePreview(text)}`);
  return { ok: true, summary };
}
