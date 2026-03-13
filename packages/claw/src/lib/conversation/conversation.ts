/**
 * Agent-to-agent conversation FSM: turn-taking, receive delay, and break conditions.
 * All conversation state lives on ClawState; this module is the single place that mutates it.
 */

import type { ConversationPhase, ConversationStateSlice, CheckBreakOptions } from "./types.js";

/** After this long in waiting_for_reply with no response, transition to idle. */
export const CONVERSATION_TIMEOUT_MS = 50_000;
/** Max full exchanges with same peer before forcing break (safety net). */
export const CONVERSATION_MAX_ROUNDS = 8;
/** Minimum delay (ms) after receiving a DM before we can reply (TTS finish). */
export const RECEIVE_REPLY_DELAY_MIN_MS = 3_000;
/** Chars per second for estimating TTS duration when audioDurationMs not in payload. */
export const TTS_CHARS_PER_SECOND = 14;
/** After a conversation ends, don't start seeking another agent for this long (ms). */
export const CONVERSATION_END_SEEK_COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes

/** Current time; separate function so tests can override via fake timers. */
function getNow(): number {
  return Date.now();
}

/**
 * True if we're allowed to send a DM to sessionId:
 * - idle: new conversation, allowed.
 * - can_reply: only to current peer, and only after receiveDelayUntil has passed.
 * - waiting_for_reply: not allowed (must wait for their reply).
 */
export function canSendDmTo(
  state: ConversationStateSlice,
  sessionId: string,
  now = getNow()
): boolean {
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
 * Call after we send a DM to targetSessionId. Transition to waiting_for_reply.
 */
export function onWeSentDm(state: ConversationStateSlice, targetSessionId: string, now = getNow()): void {
  state.conversationPhase = "waiting_for_reply";
  state.conversationPeerSessionId = targetSessionId;
  state.lastDmPeerSessionId = targetSessionId;
  state.waitingForReplySince = now;
  state.receiveDelayUntil = 0;
}

/**
 * Call when we receive a DM from fromSessionId. Transition to can_reply and set receive delay.
 */
export function onWeReceivedDm(
  state: ConversationStateSlice,
  fromSessionId: string,
  options: { audioDurationMs?: number; messageLength?: number } = {},
  now = getNow()
): void {
  const { audioDurationMs, messageLength = 0 } = options;
  const delayMs =
    audioDurationMs != null
      ? RECEIVE_REPLY_DELAY_MIN_MS + audioDurationMs
      : RECEIVE_REPLY_DELAY_MIN_MS + Math.round((messageLength / TTS_CHARS_PER_SECOND) * 1000);
  const wasSamePeer = state.conversationPeerSessionId === fromSessionId;
  state.conversationPhase = "can_reply";
  state.conversationPeerSessionId = fromSessionId;
  state.lastDmPeerSessionId = fromSessionId;
  state.receiveDelayUntil = now + delayMs;
  state.waitingForReplySince = 0;
  state.conversationRoundCount = wasSamePeer ? state.conversationRoundCount + 1 : 1;
}

/**
 * Check break conditions (timeout, peer left, owner spoke, round limit). Mutates state to idle when any trigger.
 */
export function checkBreak(state: ConversationStateSlice, now: number, options: CheckBreakOptions): void {
  const phase = state.conversationPhase;
  if (phase === "idle") return;
  const peer = state.conversationPeerSessionId;
  if (!peer) return;

  const { occupants, ownerUserId, lastTriggerUserId, maxRounds } = options;

  if (phase === "waiting_for_reply") {
    const elapsed = now - state.waitingForReplySince;
    if (elapsed >= CONVERSATION_TIMEOUT_MS) {
      clearConversation(state);
      return;
    }
  }

  const peerInRoom = occupants.some((o) => o.clientId === peer);
  if (!peerInRoom) {
    clearConversation(state);
    return;
  }

  if (ownerUserId && lastTriggerUserId === ownerUserId) {
    clearConversation(state);
    return;
  }

  if (maxRounds != null && state.conversationRoundCount >= maxRounds) {
    clearConversation(state);
    return;
  }
}

/**
 * Force transition to idle; clear peer and timers. Call on join_block, from break logic, and from end_conversation tool.
 * When skipSeekCooldown is false (default), sets conversationEndedSeekCooldownUntil so the agent won't seek again for several minutes.
 */
export function clearConversation(
  state: ConversationStateSlice,
  options?: { skipSeekCooldown?: boolean }
): void {
  state.conversationPhase = "idle";
  state.conversationPeerSessionId = null;
  state.lastDmPeerSessionId = null;
  state.receiveDelayUntil = 0;
  state.waitingForReplySince = 0;
  state.pendingDmReply = null;
  state.conversationRoundCount = 0;
  if (options?.skipSeekCooldown) {
    state.conversationEndedSeekCooldownUntil = 0;
  } else {
    state.conversationEndedSeekCooldownUntil = getNow() + CONVERSATION_END_SEEK_COOLDOWN_MS;
  }
}

/**
 * If we have a queued reply and we're now allowed to send (receive delay passed, still in can_reply), return it and clear queue.
 */
export function drainPendingReply(
  state: ConversationStateSlice,
  now = getNow()
): { text: string; targetSessionId: string } | null {
  const pending = state.pendingDmReply;
  if (!pending) return null;
  if (state.conversationPhase !== "can_reply") return null;
  if (state.conversationPeerSessionId !== pending.targetSessionId) return null;
  if (state.receiveDelayUntil > 0 && now < state.receiveDelayUntil) return null;
  state.pendingDmReply = null;
  return pending;
}

/**
 * Return current conversation peer session id (for prompts and reply target).
 */
export function getConversationPeer(state: ConversationStateSlice): string | null {
  return state.conversationPeerSessionId;
}

/**
 * True when we're in an active conversation (can_reply or waiting_for_reply). Used to avoid seeking a new agent.
 */
export function isInConversation(state: ConversationStateSlice): boolean {
  return state.conversationPhase === "can_reply" || state.conversationPhase === "waiting_for_reply";
}
