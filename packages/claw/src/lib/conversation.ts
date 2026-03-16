/**
 * Conversation FSM: turn-taking, receive delay, drain pending DM.
 */

import type { ClawStoreApi } from "./state/index.js";

export const RECEIVE_REPLY_DELAY_MIN_MS = 3000;
const TTS_CHARS_PER_SECOND = 14;

function getNow(): number {
  return Date.now();
}

export type SendReplyAction =
  | { action: "send_now" }
  | { action: "queue"; pendingDmReply: { text: string; targetSessionId: string } };

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

export function onWeSentDm(store: ClawStoreApi, targetSessionId: string, now = getNow()): void {
  store.setState({
    conversationPhase: "waiting_for_reply",
    conversationPeerSessionId: targetSessionId,
    lastDmPeerSessionId: targetSessionId,
    waitingForReplySince: now,
    receiveDelayUntil: 0,
  });
}

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

export const CONVERSATION_END_SEEK_COOLDOWN_MS = 3 * 60 * 1000;

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
