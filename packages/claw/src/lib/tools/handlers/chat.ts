import type { ToolContext } from "../types.js";
import { buildChatSendOptions } from "../../chatSendOptions.js";
import { canSendDmTo, onWeSentDm } from "../../conversation/index.js";
import { truncatePreview } from "../../log.js";

export async function handleChat(ctx: ToolContext) {
  const { client, store, args, config, logAction } = ctx;
  const state = store.getState();
  const text = typeof args.text === "string" ? args.text.slice(0, 500).trim() : "";
  let targetSessionId =
    typeof args.targetSessionId === "string" ? args.targetSessionId.trim() || undefined : undefined;
  if (text && !targetSessionId && state.lastDmPeerSessionId) {
    targetSessionId = state.lastDmPeerSessionId;
  }
  const isDm = Boolean(targetSessionId);

  // Only one chat send per tick — avoid double reply when model returns multiple tool calls.
  if (text && state.lastTickSentChat) {
    return {
      ok: false,
      summary: "already responded",
      message: "Already sent a message this turn; wait for the other person to respond.",
    };
  }

  // Agent-to-agent: conversation FSM so conversations aren’t spammed and voice can finish.
  if (text && isDm && targetSessionId && !canSendDmTo(store, targetSessionId)) {
    store.setState({ pendingDmReply: { text, targetSessionId } });
    return {
      ok: true,
      summary: "queued",
      message: "Reply will be sent after a short delay (turn-taking).",
    };
  }

  if (text) {
    const voiceId =
      (typeof args.voiceId === "string" ? args.voiceId.trim() : null) || config.voiceId || undefined;
    client.sendChat(text, buildChatSendOptions({ targetSessionId, voiceId }));
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
