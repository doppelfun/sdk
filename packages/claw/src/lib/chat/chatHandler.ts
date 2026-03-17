/**
 * Handle incoming chat message from engine WS: push to store, set lastTriggerUserId if owner/DM, request wake.
 * Wire this to your client's onMessage("chat", ...) so the behaviour tree sees the wake and runs Obedient or Autonomous.
 */
import type { ClawStore } from "../state/index.js";
import type { ClawConfig } from "../config/index.js";
import { clearConversation, onWeReceivedDm } from "../conversation.js";
import { requestWake } from "../../wake.js";
import { isDmChannel } from "../../util/dm.js";
import { hashString } from "../../util/hash.js";

/** Incoming chat message payload from engine (username, message, channelId, etc.). */
export type ChatPayload = {
  username?: string;
  message?: string;
  text?: string;
  createdAt?: number;
  timestamp?: number;
  userId?: string;
  sessionId?: string;
  targetSessionId?: string;
  channelId?: string;
  audioDurationMs?: number;
};

/**
 * Process one chat message: push to store, set lastTriggerUserId and conversation state, request wake when agent should reply.
 * Wire to client.onMessage("chat", handleChatMessage(store, config, payload)).
 *
 * @param store - Claw store
 * @param config - Claw config (ownerUserId)
 * @param payload - Chat payload from engine
 */
export function handleChatMessage(
  store: ClawStore,
  config: ClawConfig,
  payload: ChatPayload
): void {
  const state = store.getState();

  // Skip: from self, echo of our own sent message, or duplicate (same id already in chat).
  if (state.mySessionId && payload.sessionId === state.mySessionId) return;
  const message =
    typeof payload.message === "string" ? payload.message : typeof payload.text === "string" ? payload.text : "";
  if (state.lastAgentChatMessage && message.trim() === state.lastAgentChatMessage) return;

  const username = typeof payload.username === "string" ? payload.username : "?";
  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : undefined;
  const createdAt =
    typeof payload.createdAt === "number" ? payload.createdAt : (payload.timestamp ?? Date.now()) as number;
  const idempotencyKey = hashString((sessionId ?? "") + "|" + createdAt + "|" + message);
  if (state.chat.some((c) => c.id === idempotencyKey)) return;
  const userId = typeof payload.userId === "string" && payload.userId.trim() ? payload.userId.trim() : undefined;
  const targetSessionId =
    typeof payload.targetSessionId === "string" && payload.targetSessionId.trim()
      ? payload.targetSessionId.trim()
      : undefined;
  const directedAtMe = state.mySessionId != null && targetSessionId === state.mySessionId;
  const dmFromOther =
    state.mySessionId != null &&
    sessionId != null &&
    sessionId !== state.mySessionId &&
    (isDmChannel(payload.channelId) || directedAtMe);
  const fromOwner =
    config.ownerUserId != null &&
    userId === config.ownerUserId &&
    message.length > 0 &&
    (isDmChannel(payload.channelId) || directedAtMe);

  if (fromOwner) {
    clearConversation(store);
    // Keep DM context so the agent replies in DM, not global
    if (sessionId) store.setLastDmPeerSessionId(sessionId);
  } else if (dmFromOther && sessionId) {
    onWeReceivedDm(store, sessionId, {
      audioDurationMs: payload.audioDurationMs,
      messageLength: message.length,
    });
  } else if (payload.channelId === "global") {
    clearConversation(store);
  }

  const shouldWake = fromOwner || dmFromOther;
  if (shouldWake) {
    store.setState({ lastAgentChatMessage: null, lastTickSentChat: false });
    if (userId) store.setLastTriggerUserId(userId);
  }

  store.pushChat(
    {
      username,
      message,
      createdAt,
      userId,
      sessionId,
      channelId: typeof payload.channelId === "string" ? payload.channelId : undefined,
      id: idempotencyKey,
    },
    config.maxChatContext
  );

  if (fromOwner) {
    store.pushOwnerMessage(message, config.maxOwnerMessages);
  }

  if (shouldWake && message.trim()) {
    requestWake(store, "dm");
  }
}
