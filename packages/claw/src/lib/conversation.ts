/**
 * Conversation FSM: turn-taking, receive delay, drain pending DM.
 *
 * Phases: idle → can_reply (after we receive) → waiting_for_reply (after we send).
 * receiveDelayUntil enforces a minimum delay before replying; pendingDmReply queues when we can't send yet.
 */

import { getNow } from "../util/time.js";
import { matchesStockOpeningGreeting } from "./chat/openingGreetings.js";
import type { ClawStoreApi } from "./state/index.js";

// --- Constants ---

export const RECEIVE_REPLY_DELAY_MIN_MS = 3000;

/** Random extra delay (0..max) after a received DM before we may reply, so two agents rarely go first in the same tick. */
export const RECEIVE_REPLY_STAGGER_JITTER_MS = 2500;

/** Cooldown after conversation end before autonomous agent can seek again (ms). */
export const CONVERSATION_END_SEEK_COOLDOWN_MS = 3 * 60 * 1000;

/** Max back-and-forth rounds with the same peer; after this we clear conversation so the agent can wander and find someone else. */
export const MAX_CONVERSATION_ROUNDS = 8;

const TTS_CHARS_PER_SECOND = 14;

// --- Types ---

/** Result of evaluating whether we can send a DM now or must queue. */
export type SendReplyAction =
  | { action: "send_now" }
  | { action: "queue"; pendingDmReply: { text: string; targetSessionId: string } };

// --- Greeting / conversation checks ---

/**
 * True if text looks like a short opening greeting (hi, hello, …) or matches a stock autonomous opening line.
 * Used to avoid repeating a greeting when already in conversation with the same peer.
 */
export function isGreeting(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ").replace(/[!.]/g, "");
  if (!t) return false;
  if (/^(hi|hello|hey|hi there|hey there|hello there|what'?s up|howdy|greetings)$/.test(t)) return true;
  return matchesStockOpeningGreeting(text);
}

/** True if we're already in a conversation with this session (phase not idle and peer matches — we already said something). */
export function alreadyInConversationWith(store: ClawStoreApi, sessionId: string): boolean {
  const state = store.getState();
  return state.conversationPhase !== "idle" && state.conversationPeerSessionId === sessionId;
}

/** True if we should skip sending this opening message to this peer (already in conversation and message is just a greeting). */
export function shouldSkipOpeningGreeting(
  store: ClawStoreApi,
  sessionId: string,
  openingMessage: string,
): boolean {
  return openingMessage.length > 0 && alreadyInConversationWith(store, sessionId) && isGreeting(openingMessage);
}

// --- Send / reply evaluation ---

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

// --- Phase transitions (store updaters) ---

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

/** Update store when we received a DM: phase can_reply, set receiveDelayUntil and conversation peer. Breaks conversation after MAX_CONVERSATION_ROUNDS so the agent can wander again. */
export function onWeReceivedDm(
  store: ClawStoreApi,
  fromSessionId: string,
  options: { audioDurationMs?: number; messageLength?: number } = {},
  now = getNow()
): void {
  const state = store.getState();
  const wasSamePeer = state.conversationPeerSessionId === fromSessionId;
  const nextRoundCount = wasSamePeer ? state.conversationRoundCount + 1 : 1;
  if (wasSamePeer && nextRoundCount > MAX_CONVERSATION_ROUNDS) {
    clearConversation(store);
    return;
  }
  const { audioDurationMs, messageLength = 0 } = options;
  const baseDelayMs =
    audioDurationMs != null
      ? RECEIVE_REPLY_DELAY_MIN_MS + audioDurationMs
      : RECEIVE_REPLY_DELAY_MIN_MS + Math.round((messageLength / TTS_CHARS_PER_SECOND) * 1000);
  const jitterMs = Math.floor(Math.random() * (RECEIVE_REPLY_STAGGER_JITTER_MS + 1));
  const delayMs = baseDelayMs + jitterMs;
  store.setState({
    conversationPhase: "can_reply",
    conversationPeerSessionId: fromSessionId,
    lastDmPeerSessionId: fromSessionId,
    receiveDelayUntil: now + delayMs,
    waitingForReplySince: 0,
    conversationRoundCount: nextRoundCount,
  });
}

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

// --- Drain pending ---

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
