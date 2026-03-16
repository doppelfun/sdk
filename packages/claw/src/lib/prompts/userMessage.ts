/**
 * Minimal buildUserMessage: chat, owner messages, optional scheduled task.
 */
import type { ClawConfig } from "../config/index.js";
import type { ClawStoreApi } from "../state/index.js";

/**
 * Build the user message for one agent tick: block, occupants, errors, scheduled task, owner messages, recent chat, DM hint.
 *
 * @param store - Claw store (getState)
 * @param config - Claw config (maxOwnerMessages, maxChatContext)
 * @returns Single string for the LLM user message
 */
export function buildUserMessage(store: ClawStoreApi, config: ClawConfig): string {
  const state = store.getState();
  const parts: string[] = [];

  parts.push(`Block: ${state.blockSlotId}`);

  if (state.occupants.length > 0) {
    parts.push(
      `Occupants (${state.occupants.length}): ${state.occupants.map((o) => `${o.username} (${o.clientId})`).join(", ")}`
    );
  }

  if (state.lastError) {
    parts.push(`Error: ${state.lastError.code} — ${state.lastError.message}`);
  }

  if (state.pendingScheduledTask) {
    parts.push(`Scheduled task: ${state.pendingScheduledTask.instruction}`);
  }

  const ownerMsgs = state.ownerMessages.slice(-(config.maxOwnerMessages || 5));
  if (ownerMsgs.length > 0) {
    parts.push("Owner said: " + ownerMsgs.map((m) => m.text).join(" | "));
  }

  const chatSlice = state.chat.slice(-(config.maxChatContext || 10));
  if (chatSlice.length > 0) {
    parts.push(
      "Recent chat: " +
        chatSlice.map((c) => `[${c.username}]: ${c.message}`).join(" ")
    );
  }

  if (state.lastDmPeerSessionId) {
    parts.push(`Reply in DM to session: ${state.lastDmPeerSessionId}`);
  }

  if (parts.length <= 1) parts.push("No recent context. Say hello or ask what to do.");
  return parts.join("\n");
}
