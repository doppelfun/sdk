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

export type BuildSubagentExchange = { agentSummary: string; userMessage: string };

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
  buildSubagentContext: BuildSubagentExchange[];
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

const FACE_NEARBY_RADIUS_M = 12;

/** Y rotation (radians) to face the nearest occupant with position, or undefined if none in range. */
export function getFacingTowardNearestOccupant(state: ClawState): number | undefined {
  const my = state.myPosition;
  if (!my) return undefined;
  let nearestDist2 = FACE_NEARBY_RADIUS_M * FACE_NEARBY_RADIUS_M;
  let nearest: { x: number; z: number } | null = null;
  for (const o of state.occupants) {
    if (o.clientId === state.mySessionId || !o.position) continue;
    const dx = o.position.x - my.x;
    const dz = o.position.z - my.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < nearestDist2 && d2 > 0.01) {
      nearestDist2 = d2;
      nearest = { x: o.position.x, z: o.position.z };
    }
  }
  if (!nearest) return undefined;
  return Math.atan2(nearest.x - my.x, nearest.z - my.z);
}

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
    buildSubagentContext: [],
    cachedBalance: 0,
    dailySpend: 0,
    documentsByBlockSlot: {},
    lastDocumentsList: null,
    lastCatalogContext: null,
  };
}
