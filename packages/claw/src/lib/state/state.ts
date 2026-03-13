/**
 * In-memory claw state for the agent loop.
 * Holds block slot, occupants, chat, errors, owner messages, and build state.
 * documentsByBlockSlot tracks which document id + cached MML this agent uses for the next replace/append. The block engine loads all agent documents—agent-side bookkeeping only.
 */

import type { Occupant } from "@doppelfun/sdk";

/** One chat message (from engine WS). Mentions are not tracked in Claw—use DM or owner for directed replies. */
export type ChatEntry = {
  username: string;
  message: string;
  createdAt: number;
  userId?: string;
  sessionId?: string;
  /** "global" or dm:sessionA:sessionB. Omitted for older payloads. */
  channelId?: string;
};

/** One owner command (in-world chat from owner user). */
export type OwnerMessage = { text: string; at: number };

export type BlockDocument = { documentId: string; mml: string };

/** World position (e.g. from occupants API). */
export type Position3 = { x: number; y: number; z: number };

/** Build target to walk toward (x,z only). */
export type BuildTarget = { x: number; z: number };

/**
 * Tick phase for long-term build routing.
 * must_act_build: chat is withheld until a build tool runs or phase times out—avoids chat-only promises.
 */
export type TickPhase = "idle" | "must_act_build";

export type ClawState = {
  /** Block slot id (e.g. "0_0"). Engine WS may still call this regionId in payloads. */
  blockSlotId: string;
  mySessionId: string | null;
  occupants: Occupant[];
  chat: ChatEntry[];
  /** Engine may send regionId on boundary errors; we store as blockSlotId hint for join_block. */
  lastError: { code: string; message: string; blockSlotId?: string } | null;
  ownerMessages: OwnerMessage[];
  /** Which doc id + cached MML to target for builds in this block slot; engine loads every document. */
  documentsByBlockSlot: Record<string, BlockDocument>;
  /** Tracked document id for current block slot. */
  mainDocumentId: string | null;
  /** Cached MML for tracked doc. */
  mainDocumentMml: string;
  lastTickSentChat: boolean;
  /** Last chat message we sent; used to show in prompt and avoid repeating. */
  lastAgentChatMessage: string | null;
  /** UserId of whoever last spoke in a DM to you or as owner; used for owner-gating builds. */
  lastTriggerUserId: string | null;
  /** Agent's world position when in same block (set from get_occupants when self has position). */
  myPosition: Position3 | null;
  /** Last build location to walk toward; stop when close (~2 m). */
  lastBuildTarget: BuildTarget | null;
  /**
   * When set, movementDriverTick sends input every ~50ms toward this world (x,z)
   * until within movementStopDistanceM—NPC-style continuous motion without LLM spam.
   */
  movementTarget: { x: number; z: number } | null;
  /** Stop distance for movementTarget (default 2 m). */
  movementStopDistanceM: number;
  /** Sprint while auto-approaching. */
  movementSprint: boolean;
  /**
   * When set (and no movementTarget), movementDriverTick sends this input every ~50ms—
   * same cadence as NpcDriver so motion stays smooth instead of one-shot jerk per LLM tick.
   */
  movementIntent: { moveX: number; moveZ: number; sprint: boolean } | null;
  /**
   * When > 0 and now < this timestamp, AutonomousManager is in "emote stand still" — movement
   * driver sends 0,0. Set by AutonomousManager when it triggers an emote; cleared when owner
   * nearby or when time expires.
   */
  autonomousEmoteStandStillUntil: number;
  /**
   * When set, we are autonomously approaching this agent to say openingMessage. Movement driver
   * clears movementTarget on arrive and then sends chat + speak with openingMessage to targetSessionId.
   */
  pendingGoTalkToAgent: { targetSessionId: string; openingMessage: string } | null;
  /**
   * When > 0 and now < this timestamp, AutonomousManager will not start a new "seek agent" — avoids
   * immediately re-targeting after we just said something. Set when we fire chat/speak on arrive.
   */
  autonomousSeekCooldownUntil: number;
  /** Last tool name that was run. */
  lastToolRun: string | null;
  /** Tool names invoked this tick (for follow-up when chat-only promised a build). Cleared at tick start. */
  lastTickToolNames: string[] | null;
  /** When set, last inbound was a DM from this session id — use as targetSessionId when replying. */
  lastDmPeerSessionId: string | null;
  /**
   * When > 0 and now < this timestamp, agent-to-agent chat is in cooldown (don't send DM / autonomous greeting).
   * Set after sending to slow conversations and allow voice to finish; also set when receiving a DM so we wait before replying (turn-taking).
   */
  agentChatCooldownUntil: number;
  /**
   * Queued DM reply when we tried to send but were in cooldown (e.g. receive delay). Drained in the 50ms loop when cooldown expires.
   */
  pendingDmReply: { text: string; targetSessionId: string } | null;
  /** idle = normal tick; must_act_build = run build tool before chat (deterministic or build-only LLM). */
  tickPhase: TickPhase;
  /** When set with must_act_build, executeTool(generate_procedural) runs without LLM. */
  pendingBuildKind: "city" | "pyramid" | null;
  /** Ticks spent in must_act_build without clearing; escape to idle to avoid stuck. */
  pendingBuildTicks: number;
  /**
   * When false, idle interval ticks skip the LLM (no 15k-token burn every 5s).
   * Set true on DM/owner wake, setLastError, must_act_build, and once on connect.
   * Cleared after an idle LLM run — next reaction only when something wakes again.
   */
  llmWakePending: boolean;
  /**
   * When true, the next idle LLM run is a soul-driven autonomous tick (owner away).
   * Set by scheduler; cleared when runTick starts LLM. buildUserMessage uses this to inject soul-first instructions.
   */
  autonomousSoulTickDue: boolean;
  /**
   * True when the wake was from a DM — next LLM turn must reply in thread; cleared after tick.
   * Used to force/fallback chat when the model returns no tool calls (e.g. Gemini text-only).
   */
  dmReplyPending: boolean;
  /**
   * True when setLastError just ran — next LLM turn should summarize the failure in plain language
   * and call chat (DM thread or global once). Cleared after chat is sent or lastError cleared.
   */
  errorReplyPending: boolean;
  /**
   * Compact catalog snapshot from last list_catalog (bounded size)—injected into buildUserMessage.
   * Full JSON was only in that tool turn; re-call list_catalog if more entries needed. Cleared on join_block.
   */
  lastCatalogContext: string | null;
  /**
   * Cached list_documents summary (e.g. "3 document(s): id1, id2") — injected into user message.
   * Cleared on join_block.
   */
  lastDocumentsList: string | null;
  /**
   * Short summary from last get_occupants (e.g. "4 occupants") — occupants array is already in state;
   * this flags that a fetch happened so prompts can say not to re-call unnecessarily.
   */
  lastOccupantsSummary: string | null;
};

/** Cooldown (ms) after sending agent-to-agent chat before next send — allows voice to finish; keep short so they respond once per turn. */
export const AGENT_CHAT_COOLDOWN_MS = 5_000;
/** After receiving a DM from another agent, wait this long before we're allowed to send a reply — gives their TTS time to play so we don't talk over each other. */
export const RECEIVE_REPLY_DELAY_MS = 4_000;

/** Set cooldown so we can't send a reply until RECEIVE_REPLY_DELAY_MS from now (call when we receive a DM from another agent). */
export function setReceiveReplyDelay(state: ClawState, now = Date.now()): void {
  const until = now + RECEIVE_REPLY_DELAY_MS;
  if (state.agentChatCooldownUntil < until) state.agentChatCooldownUntil = until;
}

/** True if agent-to-agent chat is currently in cooldown (used before sending DM or autonomous greeting). */
export function isAgentChatCooldownActive(state: ClawState, now = Date.now()): boolean {
  return state.agentChatCooldownUntil > 0 && now < state.agentChatCooldownUntil;
}

/** Set agent chat cooldown; call after sending a DM or autonomous greeting. */
export function setAgentChatCooldown(state: ClawState, now = Date.now()): void {
  state.agentChatCooldownUntil = now + AGENT_CHAT_COOLDOWN_MS;
}

/** Remaining cooldown in ms (0 if not active). Used for tool-result message. */
export function getAgentChatCooldownRemainingMs(state: ClawState, now = Date.now()): number {
  if (state.agentChatCooldownUntil <= 0 || now >= state.agentChatCooldownUntil) return 0;
  return state.agentChatCooldownUntil - now;
}

/** True if we have a DM peer and that peer is an agent with position in the current block (so we stay put). */
export function isInConversationWithAgentInRoom(state: ClawState): boolean {
  if (state.lastDmPeerSessionId == null) return false;
  return state.occupants.some(
    (o) =>
      o.type === "agent" &&
      o.clientId === state.lastDmPeerSessionId &&
      o.position != null
  );
}

/** Max distance (m) to consider for facing toward a nearby occupant. */
const FACE_NEARBY_RADIUS_M = 12;

/** Y rotation (radians) to face the nearest occupant (player or agent) with position, or undefined if none in range. */
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

/** Create initial state for a block slot id (e.g. "0_0"). */
export function createInitialState(blockSlotId: string): ClawState {
  return {
    blockSlotId,
    mySessionId: null,
    occupants: [],
    chat: [],
    lastError: null,
    ownerMessages: [],
    documentsByBlockSlot: {},
    mainDocumentId: null,
    mainDocumentMml: "",
    lastTickSentChat: false,
    lastAgentChatMessage: null,
    lastTriggerUserId: null,
    myPosition: null,
    lastBuildTarget: null,
    movementTarget: null,
    movementStopDistanceM: 2,
    movementSprint: false,
    movementIntent: null,
    autonomousEmoteStandStillUntil: 0,
    pendingGoTalkToAgent: null,
    autonomousSeekCooldownUntil: 0,
    lastToolRun: null,
    lastTickToolNames: null,
    lastDmPeerSessionId: null,
    agentChatCooldownUntil: 0,
    pendingDmReply: null,
    tickPhase: "idle",
    pendingBuildKind: null,
    pendingBuildTicks: 0,
    llmWakePending: true,
    autonomousSoulTickDue: false,
    dmReplyPending: false,
    errorReplyPending: false,
    lastCatalogContext: null,
    lastDocumentsList: null,
    lastOccupantsSummary: null,
  };
}

/** Sync mainDocumentId/mainDocumentMml from tracked doc for current block slot. */
export function syncMainDocumentForBlock(state: ClawState): void {
  const doc = state.documentsByBlockSlot[state.blockSlotId];
  state.mainDocumentId = doc?.documentId ?? null;
  state.mainDocumentMml = doc?.mml ?? "";
}

/** Append chat entry; keep at most max. */
export function pushChat(state: ClawState, entry: ChatEntry, max: number): void {
  state.chat.push(entry);
  if (state.chat.length > max) state.chat.shift();
}

/** Append owner message; keep at most max. */
export function pushOwnerMessage(state: ClawState, text: string, max: number): void {
  state.ownerMessages.push({ text, at: Date.now() });
  if (state.ownerMessages.length > max) state.ownerMessages.shift();
}

/** Set last error (e.g. boundary). Optional blockSlotId for join_block hint (engine may send as regionId). */
export function setLastError(
  state: ClawState,
  code: string,
  message: string,
  blockSlotId?: string
): void {
  state.lastError = { code, message, blockSlotId };
  state.llmWakePending = true;
  state.errorReplyPending = true;
}

/** Clear error and reply flag (e.g. after join or after user was notified). */
export function clearLastError(state: ClawState): void {
  state.lastError = null;
  state.errorReplyPending = false;
}
