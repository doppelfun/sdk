import type { ToolContext } from "../types.js";
import {
  getAgentChatCooldownRemainingMs,
  isAgentChatCooldownActive,
  setAgentChatCooldown,
} from "../../state/state.js";

export async function handleChat(ctx: ToolContext) {
  const { client, state, args, logAction } = ctx;
  const text = typeof args.text === "string" ? args.text.slice(0, 500).trim() : "";
  let targetSessionId =
    typeof args.targetSessionId === "string" ? args.targetSessionId.trim() || undefined : undefined;
  if (text && !targetSessionId && state.lastDmPeerSessionId) {
    targetSessionId = state.lastDmPeerSessionId;
  }
  const isDm = Boolean(targetSessionId);

  // Agent-to-agent: enforce cooldown so conversations aren’t spammed and voice can finish.
  if (text && isDm && isAgentChatCooldownActive(state)) {
    const remainingMs = getAgentChatCooldownRemainingMs(state);
    const waitSec = Math.ceil(remainingMs / 1000);
    return {
      ok: false,
      summary: "chat cooldown",
      cooldownSeconds: waitSec,
      message: `Agent chat cooldown active; wait ${waitSec}s before sending again (lets voice finish).`,
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
