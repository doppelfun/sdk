/**
 * Agent-to-agent conversation FSM: turn-taking, receive delay, and break conditions.
 * All conversation state lives on ClawState; this module updates it via the store (getState/setState).
 */

import type { ClawStoreApi } from "../state/store.js";
import type { CheckBreakOptions } from "./types.js";

/** After this long in waiting_for_reply with no response, transition to idle. */
export const CONVERSATION_TIMEOUT_MS = 50_000;

/** Max full exchanges with same peer before forcing break (safety net). */
export const CONVERSATION_MAX_ROUNDS = 8;

/** Minimum delay (ms) after receiving a DM before we can reply (TTS finish). */
export const RECEIVE_REPLY_DELAY_MIN_MS = 3_000;

/** Chars per second for estimating TTS duration when audioDurationMs not in payload. */
export const TTS_CHARS_PER_SECOND = 14;

/** After a conversation ends, don't start seeking another agent for this long (ms). */
export const CONVERSATION_END_SEEK_COOLDOWN_MS = 3 * 60 * 1000;

/** Current time in ms; separate function so tests can override via fake timers. */
function getNow(): number {
  return Date.now();
}

/**
 * Result of evaluateSendReply: either send now or queue for the drain step.
 * Single gate for "can we send this DM or do we queue?" used by chat tool and fallbacks.
 * @see docs/PLAN-WORKFLOW-PATTERNS.md Phase 6
 */
export type SendReplyAction =
  | { action: "send_now" }
  | { action: "queue"; pendingDmReply: { text: string; targetSessionId: string } };

/**
 * Evaluate whether we can send a DM now or must queue it for the 50 ms drain step.
 * Global chat (targetSessionId null) always returns send_now.
 *
 * @param store - Claw store (read via getState()).
 * @param targetSessionId - DM target session, or null for global (always send_now).
 * @param text - Message text (stored when queueing).
 * @param now - Current time (ms); defaults to getNow() for tests.
 * @returns send_now or queue with pendingDmReply for the caller to setState and let drain apply.
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
 * True if we're allowed to send a DM to sessionId.
 * - idle: new conversation, allowed.
 * - can_reply: only to current peer, and only after receiveDelayUntil has passed.
 * - waiting_for_reply: not allowed (must wait for their reply).
 *
 * @param store - Claw store (read via getState()).
 * @param sessionId - Target session we want to send a DM to.
 * @param now - Current time (ms); defaults to getNow() for tests.
 * @returns True when sending a DM to sessionId is allowed.
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
 * Call after we send a DM to targetSessionId.
 * Transitions to waiting_for_reply and records peer + timestamp.
 *
 * @param store - Claw store (write via setState()).
 * @param targetSessionId - Session we just sent the DM to.
 * @param now - Current time (ms); defaults to getNow().
 */
export function onWeSentDm(store: ClawStoreApi, targetSessionId: string, now = getNow()): void {
  store.setState({
    conversationPhase: "waiting_for_reply",
    conversationPeerSessionId: targetSessionId,
    lastDmPeerSessionId: targetSessionId,
    waitingForReplySince: now,
    receiveDelayUntil: 0,
  });
}

/**
 * Call when we receive a DM from fromSessionId.
 * Transitions to can_reply and sets receiveDelayUntil (TTS finish + min delay).
 *
 * @param store - Claw store (read + write via getState/setState).
 * @param fromSessionId - Session that sent the DM.
 * @param options - Optional audioDurationMs (from engine) or messageLength for delay estimate.
 * @param now - Current time (ms); defaults to getNow().
 */
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

/**
 * Check break conditions: timeout, peer left, owner spoke, round limit.
 * Updates store to idle (via clearConversation) when any condition triggers.
 *
 * @param store - Claw store (read + write).
 * @param now - Current time (ms).
 * @param options - Occupants (for peer presence), ownerUserId, lastTriggerUserId, maxRounds.
 */
export function checkBreak(store: ClawStoreApi, now: number, options: CheckBreakOptions): void {
  const state = store.getState();
  const phase = state.conversationPhase;
  if (phase === "idle") return;
  const peer = state.conversationPeerSessionId;
  if (!peer) return;

  const { occupants, ownerUserId, lastTriggerUserId, maxRounds } = options;

  if (phase === "waiting_for_reply") {
    const elapsed = now - state.waitingForReplySince;
    if (elapsed >= CONVERSATION_TIMEOUT_MS) {
      clearConversation(store);
      return;
    }
  }

  const peerInRoom = occupants.some((o) => o.clientId === peer);
  if (!peerInRoom) {
    clearConversation(store);
    return;
  }

  if (ownerUserId && lastTriggerUserId === ownerUserId) {
    clearConversation(store);
    return;
  }

  if (maxRounds != null && state.conversationRoundCount >= maxRounds) {
    clearConversation(store);
    return;
  }
}

/**
 * Force transition to idle; clear peer, timers, and pending reply.
 * Call on join_block, from break logic, and from end_conversation tool.
 * When skipSeekCooldown is false (default), sets conversationEndedSeekCooldownUntil
 * so the agent won't seek again for several minutes.
 *
 * @param store - Claw store (write via setState()).
 * @param options - skipSeekCooldown: when true, do not set conversationEndedSeekCooldownUntil (e.g. on join_block).
 */
export function clearConversation(
  store: ClawStoreApi,
  options?: { skipSeekCooldown?: boolean }
): void {
  store.setState({
    conversationPhase: "idle",
    conversationPeerSessionId: null,
    lastDmPeerSessionId: null,
    receiveDelayUntil: 0,
    waitingForReplySince: 0,
    pendingDmReply: null,
    conversationRoundCount: 0,
    conversationEndedSeekCooldownUntil: options?.skipSeekCooldown
      ? 0
      : getNow() + CONVERSATION_END_SEEK_COOLDOWN_MS,
  });
}

/**
 * If we have a queued reply and we're now allowed to send (receive delay passed, still in can_reply),
 * return it and clear the queue.
 *
 * @param store - Claw store (read + write).
 * @param now - Current time (ms); defaults to getNow().
 * @returns The pending reply (text + targetSessionId) or null if none or not yet allowed.
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

/**
 * Return current conversation peer session id.
 * Used for prompts and as reply target when sending a DM.
 *
 * @param store - Claw store (read via getState()).
 * @returns Peer session id or null when idle / no peer.
 */
export function getConversationPeer(store: ClawStoreApi): string | null {
  return store.getState().conversationPeerSessionId;
}

/**
 * True when we're in an active conversation (can_reply or waiting_for_reply).
 * Used to avoid seeking a new agent while already in a conversation.
 *
 * @param store - Claw store (read via getState()).
 * @returns True when phase is can_reply or waiting_for_reply.
 */
export function isInConversation(store: ClawStoreApi): boolean {
  const phase = store.getState().conversationPhase;
  return phase === "can_reply" || phase === "waiting_for_reply";
}
