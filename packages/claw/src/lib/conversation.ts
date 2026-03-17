/**
 * Conversation FSM: turn-taking, receive delay, drain pending DM.
 */

import type { ClawStoreApi } from "./state/index.js";

export const RECEIVE_REPLY_DELAY_MIN_MS = 3000;
const TTS_CHARS_PER_SECOND = 14;

function getNow(): number {
  return Date.now();
}

/** Result of evaluating whether we can send a DM now or must queue. */
export type SendReplyAction =
  | { action: "send_now" }
  | { action: "queue"; pendingDmReply: { text: string; targetSessionId: string } };

/**
 * Decide whether to send a DM now or queue it (turn-taking / receive delay).
 *
 * @param store - Claw store
 * @param targetSessionId - DM recipient
 * @param text - Message text
 * @param now - Current timestamp (default Date.now())
 * @returns send_now or queue with pendingDmReply
 */
export function evaluateSendReply(
  store: ClawStoreApi,
  targetSessionId: string | null,
  text: string,
  now = getNow()
): SendReplyAction {
  if (!targetSessionId) return { action: "send_now" };
  if (canSendDmTo(store, targetSessionId, now)) return { action: "send_now" };
  return { action: "queue", pendingDmReply: { text, targetSessionId } };
}

/**
 * True if we can send a DM to this session (phase allows it and receive delay elapsed).
 */
export function canSendDmTo(
  store: ClawStoreApi,
  sessionId: string,
  now = getNow()
): boolean {
  const state = store.getState();
  const phase = state.conversationPhase;
  if (phase === "idle") return true;
  if (phase === "waiting_for_reply") return false;
  if (phase === "can_reply") {
    if (state.conversationPeerSessionId !== sessionId) return false;
    return state.receiveDelayUntil <= 0 || now >= state.receiveDelayUntil;
  }
  return false;
}

/** Update store after we sent a DM: phase waiting_for_reply, set peer and lastDmPeerSessionId. */
export function onWeSentDm(store: ClawStoreApi, targetSessionId: string, now = getNow()): void {
  store.setState({
    conversationPhase: "waiting_for_reply",
    conversationPeerSessionId: targetSessionId,
    lastDmPeerSessionId: targetSessionId,
    waitingForReplySince: now,
    receiveDelayUntil: 0,
  });
}

/** Update store when we received a DM: phase can_reply, set receiveDelayUntil and conversation peer. */
export function onWeReceivedDm(
  store: ClawStoreApi,
  fromSessionId: string,
  options: { audioDurationMs?: number; messageLength?: number } = {},
  now = getNow()
): void {
  const state = store.getState();
  const { audioDurationMs, messageLength = 0 } = options;
  const delayMs =
    audioDurationMs != null
      ? RECEIVE_REPLY_DELAY_MIN_MS + audioDurationMs
      : RECEIVE_REPLY_DELAY_MIN_MS + Math.round((messageLength / TTS_CHARS_PER_SECOND) * 1000);
  const wasSamePeer = state.conversationPeerSessionId === fromSessionId;
  store.setState({
    conversationPhase: "can_reply",
    conversationPeerSessionId: fromSessionId,
    lastDmPeerSessionId: fromSessionId,
    receiveDelayUntil: now + delayMs,
    waitingForReplySince: 0,
    conversationRoundCount: wasSamePeer ? state.conversationRoundCount + 1 : 1,
  });
}

/** Cooldown after conversation end before autonomous agent can seek again (ms). */
export const CONVERSATION_END_SEEK_COOLDOWN_MS = 3 * 60 * 1000;

/** Reset conversation state to idle; optionally set conversationEndedSeekCooldownUntil. */
export function clearConversation(
  store: ClawStoreApi,
  options?: { skipSeekCooldown?: boolean }
): void {
  const cooldown = options?.skipSeekCooldown ? 0 : getNow() + CONVERSATION_END_SEEK_COOLDOWN_MS;
  store.setState({
    conversationPhase: "idle",
    conversationPeerSessionId: null,
    lastDmPeerSessionId: null,
    receiveDelayUntil: 0,
    waitingForReplySince: 0,
    pendingDmReply: null,
    conversationRoundCount: 0,
    conversationEndedSeekCooldownUntil: cooldown,
  });
}

/**
 * If we can reply now and there is a pending DM, clear it and return it for sending.
 *
 * @param store - Claw store
 * @param now - Current timestamp
 * @returns Pending reply to send, or null
 */
export function drainPendingReply(
  store: ClawStoreApi,
  now = getNow()
): { text: string; targetSessionId: string } | null {
  const state = store.getState();
  const pending = state.pendingDmReply;
  if (!pending) return null;
  if (state.conversationPhase !== "can_reply") return null;
  if (state.conversationPeerSessionId !== pending.targetSessionId) return null;
  if (state.receiveDelayUntil > 0 && now < state.receiveDelayUntil) return null;
  store.setState({ pendingDmReply: null });
  return pending;
}
