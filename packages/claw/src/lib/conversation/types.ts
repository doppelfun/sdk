/**
 * Types for the agent-to-agent conversation FSM.
 * State is stored on ClawState and updated only via conversation.ts.
 */

/** FSM phase: idle (no conversation), can_reply (received DM, delay passed), waiting_for_reply (we sent, waiting). */
export type ConversationPhase = "idle" | "can_reply" | "waiting_for_reply";

/**
 * Slice of ClawState that the conversation module reads and writes.
 * All conversation state lives here; mutation is only via conversation.ts.
 */
export type ConversationStateSlice = {
  conversationPhase: ConversationPhase;
  conversationPeerSessionId: string | null;
  /** Timestamp (ms) after which we're allowed to send a reply (receive delay). */
  receiveDelayUntil: number;
  /** When we entered waiting_for_reply (ms); used for timeout. */
  waitingForReplySince: number;
  /** Queued DM to send when we transition to can_reply and delay passes. */
  pendingDmReply: { text: string; targetSessionId: string } | null;
  /** Number of full exchanges with current peer; used for max-rounds break. */
  conversationRoundCount: number;
  /** Kept in sync with conversationPeerSessionId for prompts and reply target. */
  lastDmPeerSessionId: string | null;
  /** When > 0 and now < this, autonomous manager will not seek (set when conversation ends). */
  conversationEndedSeekCooldownUntil: number;
};

/**
 * Options for checkBreak: who's in the room, owner, last trigger, and optional round limit.
 */
export type CheckBreakOptions = {
  /** Current occupants (for peer presence check). */
  occupants: { clientId: string }[];
  /** Owner user id; when lastTriggerUserId matches, we break (owner spoke). */
  ownerUserId?: string | null;
  /** Last user that triggered a wake (e.g. from chat). */
  lastTriggerUserId?: string | null;
  /** Max rounds with same peer before forcing break; optional. */
  maxRounds?: number;
};
