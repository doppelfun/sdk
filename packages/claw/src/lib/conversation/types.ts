/**
 * Types for the agent-to-agent conversation FSM.
 * State is stored on ClawState and updated only via conversation.ts.
 */

export type ConversationPhase = "idle" | "can_reply" | "waiting_for_reply";

/** Slice of ClawState that the conversation module reads and writes. */
export type ConversationStateSlice = {
  conversationPhase: ConversationPhase;
  conversationPeerSessionId: string | null;
  receiveDelayUntil: number;
  waitingForReplySince: number;
  pendingDmReply: { text: string; targetSessionId: string } | null;
  conversationRoundCount: number;
  /** Kept in sync with conversationPeerSessionId for prompts and isInConversationWithAgentInRoom. */
  lastDmPeerSessionId: string | null;
  /** When > 0 and now < this, autonomous manager will not seek (set when conversation ends). */
  conversationEndedSeekCooldownUntil: number;
};

export type CheckBreakOptions = {
  occupants: { clientId: string }[];
  ownerUserId?: string | null;
  lastTriggerUserId?: string | null;
  maxRounds?: number;
};
