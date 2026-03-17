/**
 * Wake-driven agent state. No tickPhase, pendingBuildKind, or pendingBuildTicks.
 * @see docs/PLAN-AGENT-WAKE-DRIVEN.md
 */

import type { Occupant } from "@doppelfun/sdk";

export type ChatEntry = {
  username: string;
  message: string;
  createdAt: number;
  userId?: string;
  sessionId?: string;
  channelId?: string;
  /** Idempotency key (e.g. hash(sessionId + message)); skip push if already in chat. */
  id?: string;
};

export type OwnerMessage = { text: string; at: number };

export type Position3 = { x: number; y: number; z: number };

export type BuildTarget = { x: number; z: number };

/** Scheduled task from cron wake; consumed by Obedient agent. */
export type PendingScheduledTask = {
  taskId: string;
  instruction: string;
  [k: string]: unknown;
};

/** Tracked document per block for replace/append (build tools). */
export type BlockDocument = { documentId: string; mml: string };

export type ClawState = {
  blockSlotId: string;
  mySessionId: string | null;
  occupants: Occupant[];
  chat: ChatEntry[];
  lastError: { code: string; message: string; blockSlotId?: string } | null;
  ownerMessages: OwnerMessage[];
  lastTriggerUserId: string | null;
  myPosition: Position3 | null;
  movementTarget: { x: number; z: number } | null;
  lastMoveToFailed: { x: number; z: number } | null;
  /** When set, agent is following this sessionId (server-driven). Cleared on cancel_follow or follow_failed. */
  followTargetSessionId: string | null;
  /** Set when server sends follow_failed (target left or no path). */
  lastFollowFailed: string | null;
  movementStopDistanceM: number;
  movementSprint: boolean;
  movementIntent: { moveX: number; moveZ: number; sprint: boolean } | null;
  lastBuildTarget: BuildTarget | null;
  /** When set, movement driver sends greeting then clears. */
  pendingGoTalkToAgent: { targetSessionId: string; openingMessage: string } | null;
  /** When > 0 and now < this timestamp, movement driver sends 0,0 (e.g. after emote). */
  autonomousEmoteStandStillUntil: number;
  autonomousSeekCooldownUntil: number;
  /** When > 0, do not start new seek until after this time (e.g. after conversation end). */
  conversationEndedSeekCooldownUntil: number;
  nextSeekConsiderAt: number;
  lastDmPeerSessionId: string | null;
  conversationPhase: "idle" | "can_reply" | "waiting_for_reply";
  conversationPeerSessionId: string | null;
  receiveDelayUntil: number;
  waitingForReplySince: number;
  pendingDmReply: { text: string; targetSessionId: string } | null;
  conversationRoundCount: number;
  lastTickSentChat: boolean;
  lastAgentChatMessage: string | null;
  /** Wake-driven: true when there is work (DM, autonomous, cron). */
  wakePending: boolean;
  /** Set by requestWake("cron", { task }); cleared after RunObedientAgent. */
  pendingScheduledTask: PendingScheduledTask | null;
  /** Last time we ran the autonomous agent (for TimeForAutonomousWake). */
  lastAutonomousRunAt: number;
  lastToolRun: string | null;
  lastTickToolNames: string[] | null;
  lastOccupantsSummary: string | null;
  /** Cached balance from hub (when hosted). */
  cachedBalance: number;
  /** Daily spend so far (when hosted); reset by hub. */
  dailySpend: number;
  /** Document id + MML per block for build replace/append. */
  documentsByBlockSlot: Record<string, BlockDocument>;
  /** Cached list_documents result for build subagent. */
  lastDocumentsList: string | null;
  /** Cached list_catalog compact for build subagent. */
  lastCatalogContext: string | null;
};

/**
 * Create initial ClawState for a block. wakePending is true so the first tick runs.
 *
 * @param blockSlotId - Block slot id (e.g. "0_0")
 * @returns Fresh state with empty chat, no movement target, idle conversation
 */
export function createInitialState(blockSlotId: string): ClawState {
  return {
    blockSlotId,
    mySessionId: null,
    occupants: [],
    chat: [],
    lastError: null,
    ownerMessages: [],
    lastTriggerUserId: null,
    myPosition: null,
    movementTarget: null,
    lastMoveToFailed: null,
    followTargetSessionId: null,
    lastFollowFailed: null,
    movementStopDistanceM: 2,
    movementSprint: false,
    movementIntent: null,
    lastBuildTarget: null,
    pendingGoTalkToAgent: null,
    autonomousEmoteStandStillUntil: 0,
    autonomousSeekCooldownUntil: 0,
    conversationEndedSeekCooldownUntil: 0,
    nextSeekConsiderAt: 0,
    lastDmPeerSessionId: null,
    conversationPhase: "idle",
    conversationPeerSessionId: null,
    receiveDelayUntil: 0,
    waitingForReplySince: 0,
    pendingDmReply: null,
    conversationRoundCount: 0,
    lastTickSentChat: false,
    lastAgentChatMessage: null,
    wakePending: true,
    pendingScheduledTask: null,
    lastAutonomousRunAt: 0,
    lastToolRun: null,
    lastTickToolNames: null,
    lastOccupantsSummary: null,
    cachedBalance: 0,
    dailySpend: 0,
    documentsByBlockSlot: {},
    lastDocumentsList: null,
    lastCatalogContext: null,
  };
}
