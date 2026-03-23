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

/** Random wander state (aligned with engine NpcDriver heading/speed behavior). */
export type WanderState = {
  heading: number;
  targetHeading: number;
  speed: number;
  targetSpeed: number;
  nextHeadingRetargetAt: number;
  nextSpeedRetargetAt: number;
};

/** Scheduled task from cron wake; consumed by Obedient agent. */
export type PendingScheduledTask = {
  taskId: string;
  instruction: string;
  [k: string]: unknown;
};

/** Tracked document per block for replace/append (build tools). */
export type BlockDocument = { documentId: string; mml: string };

/** Set by tree agent callbacks (and runner on LLM failure). Single source of truth for "what is the agent doing." */
export type TreeAction =
  | "idle"
  | "movement_only"
  | "obedient"
  | "autonomous_llm"
  | "autonomous_move"
  | "autonomous_seek_social"
  | "autonomous_converse"
  | "clearing_wake_insufficient_credits"
  | "requesting_autonomous_wake"
  | "error";

/** Decision-layer goal for autonomous agent (navigation + social). Obedient agent ignores this. */
export type AutonomousGoal = "idle" | "wander" | "approach" | "converse";

export type ClawState = {
  blockSlotId: string;
  /** Set by behaviour tree action callbacks. Single place to read current flow. */
  currentAction: TreeAction;
  /** Last action that completed (for debugging/audit). Set when an action callback finishes. */
  lastCompletedAction: TreeAction | null;
  /** Timestamp when lastCompletedAction was set (0 when null). */
  lastCompletedActionAt: number;
  /** True while an LLM tick is in progress (runner sets around sendThinking). Use for UI "thinking" indicator. */
  isThinking: boolean;
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
  /** When set, movement driver uses this for random wander when no target/intent (engine NPC-style). */
  wanderState: WanderState | null;
  /** Next time (ms) to pick a pathfinding wander destination; 0 = pick as soon as idle. Aligned with engine PATHFIND_RETARGET_MS. */
  nextWanderDestinationAt: number;
  /** Next time (ms) to allow autonomous move (move-to-nearest or wander); 0 = allowed. Set when starting move and on arrival. */
  nextAutonomousMoveAt: number;
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
  /** Timestamp (ms) of last owner-triggered conversation; autonomous wake only after 1 min since this. */
  lastOwnerConversationAt: number;
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
  /** --- Autonomous blackboard (decision layer). Obedient agent ignores these. --- */
  /** Current high-level goal: idle/wander → seek or move; approach → moving to target; converse → in conversation. */
  autonomousGoal: AutonomousGoal;
  /** SessionId we are approaching or in conversation with (set by SeekSocialTarget, cleared on ExitConversationToWander). */
  autonomousTargetSessionId: string | null;
  /** Next time (ms) we may look for a new social target; cooldown after SeekSocialTarget or after conversation end. */
  socialSeekCooldownUntil: number;
  /** Last session id chosen by SeekSocialTarget; used to deprioritize repeat picks when other targets exist. */
  lastSocialSeekTargetSessionId: string | null;
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
    currentAction: "idle",
    lastCompletedAction: null,
    lastCompletedActionAt: 0,
    isThinking: false,
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
    wanderState: null,
    nextWanderDestinationAt: 0,
    nextAutonomousMoveAt: 0,
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
    lastOwnerConversationAt: 0,
    lastToolRun: null,
    lastTickToolNames: null,
    lastOccupantsSummary: null,
    cachedBalance: 0,
    dailySpend: 0,
    documentsByBlockSlot: {},
    lastDocumentsList: null,
    lastCatalogContext: null,
    autonomousGoal: "wander",
    autonomousTargetSessionId: null,
    socialSeekCooldownUntil: 0,
    lastSocialSeekTargetSessionId: null,
  };
}

/**
 * True when the agent is in an LLM run (obedient or autonomous). Use for UI "thinking" or to avoid starting another run.
 */
export function isAgentRunningLlm(state: ClawState): boolean {
  return state.currentAction === "obedient" || state.currentAction === "autonomous_llm";
}

/** True when the last LLM tick failed. Cleared when the next tree step runs. */
export function isAgentInError(state: ClawState): boolean {
  return state.currentAction === "error";
}
