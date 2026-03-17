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

  // Single current message to act on: owner DM or scheduled task (treat cron like a DM so the agent executes it).
  const lastOwner = state.ownerMessages[state.ownerMessages.length - 1];
  if (lastOwner) {
    parts.push(`Current message to respond to: ${lastOwner.text}`);
  } else if (state.pendingScheduledTask) {
    parts.push(`Current message to respond to (scheduled task — execute with tools, do not just acknowledge): ${state.pendingScheduledTask.instruction}`);
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
