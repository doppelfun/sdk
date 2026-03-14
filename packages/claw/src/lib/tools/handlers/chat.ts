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

  // Do not repeat any message we've already sent (use recent history, not just last).
  if (text) {
    const norm = (s: string) => s.toLowerCase().trim();
    const normalized = norm(text);
    const recentOurs = state.recentAgentChatMessages ?? [];
    if (recentOurs.some((prev) => norm(prev) === normalized)) {
      return {
        ok: false,
        summary: "repeat blocked",
        message:
          "You already said that in this conversation. Send something different or skip chat (e.g. use a different phrase, answer the question, or say goodbye).",
      };
    }
    // Do not repeat what someone else just said (avoids multiple agents saying the same thing).
    const recentTheirs = state.chat ?? [];
    if (recentTheirs.some((e) => norm(e.message) === normalized)) {
      return {
        ok: false,
        summary: "repeat blocked",
        message:
          "Someone else already said that. Say something different so you don't echo others.",
      };
    }
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
