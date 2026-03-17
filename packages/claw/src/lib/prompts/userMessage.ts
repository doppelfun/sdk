/**
 * Minimal buildUserMessage: chat, owner messages, optional scheduled task.
 */
import type { ClawConfig } from "../config/index.js";
import type { ClawStoreApi } from "../state/index.js";

/**
 * Build the user message for one agent tick: block, occupants, errors, scheduled task, single current message, conversation history, DM hint.
 * Only the most recent owner message is "current"; older ones are in chat history. Respond only to the current message.
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

  // Single current message to act on (most recent only); multiple rapid messages are already in chat
  const lastOwner = state.ownerMessages[state.ownerMessages.length - 1];
  if (lastOwner) {
    parts.push(`Current message to respond to: ${lastOwner.text}`);
  }

  const chatSlice = state.chat.slice(-(config.maxChatContext || 10));
  if (chatSlice.length > 0) {
    parts.push(
      "Conversation history (for context only; do not re-execute or re-acknowledge past commands):"
    );
    parts.push(
      chatSlice.map((c) => `[${c.username}]: ${c.message}`).join(" ")
    );
  }

  if (state.lastDmPeerSessionId) {
    parts.push(`Reply in DM to session: ${state.lastDmPeerSessionId}`);
  }

  if (parts.length <= 1) parts.push("No recent context. Say hello or ask what to do.");
  return parts.join("\n");
}
