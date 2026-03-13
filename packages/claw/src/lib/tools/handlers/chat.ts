import type { ToolContext } from "../types.js";
import { isAgentChatCooldownActive, setAgentChatCooldown } from "../../state/state.js";

export async function handleChat(ctx: ToolContext) {
  const { client, state, args, logAction } = ctx;
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

  // Agent-to-agent: enforce cooldown so conversations aren’t spammed and voice can finish.
  // If in cooldown (e.g. receive delay), queue reply and send when cooldown expires so we don't talk over each other.
  if (text && isDm && isAgentChatCooldownActive(state)) {
    state.pendingDmReply = { text, targetSessionId: targetSessionId! };
    return {
      ok: true,
      summary: "queued",
      message: "Reply will be sent after a short delay (turn-taking).",
    };
  }

  const voiceId =
    typeof args.voiceId === "string" && args.voiceId.trim() ? args.voiceId.trim() : undefined;
  if (text) {
    client.sendChat(text, targetSessionId ? { targetSessionId } : undefined);
    state.lastAgentChatMessage = text;
    state.lastTickSentChat = true;
    if (targetSessionId) {
      state.lastDmPeerSessionId = targetSessionId;
      setAgentChatCooldown(state);
    } else {
      state.lastDmPeerSessionId = null;
    }
    client.sendSpeak(text, voiceId ? { voiceId } : undefined);
  }
  const summary = targetSessionId ? "sent DM" : "sent chat";
  if (text) logAction(`${summary}: ${text.slice(0, 60)}${text.length > 60 ? "…" : ""}`);
  return { ok: true, summary };
}
