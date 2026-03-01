/**
 * In-memory claw state for the agent loop.
 * Holds region, occupants, chat, errors, owner messages, and build state.
 * One document per region in documentsByRegion; mainDocumentId/mainDocumentMml mirror the current region's doc.
 */

import type { Occupant } from "@doppelfun/sdk";

/** One @mention in a chat message (sessionId + username). */
export type ChatMention = { sessionId: string; username: string };

/** One chat message (from engine WS). */
export type ChatEntry = {
  username: string;
  message: string;
  createdAt: number;
  userId?: string;
  sessionId?: string;
  mentions?: ChatMention[];
};

/** One owner command (in-world chat from owner user). */
export type OwnerMessage = { text: string; at: number };

export type RegionDocument = { documentId: string; mml: string };

/** World position (e.g. from occupants API). */
export type Position3 = { x: number; y: number; z: number };

/** Build target to walk toward (x,z only). */
export type BuildTarget = { x: number; z: number };

export type ClawState = {
  regionId: string;
  mySessionId: string | null;
  occupants: Occupant[];
  chat: ChatEntry[];
  lastError: { code: string; message: string; regionId?: string } | null;
  ownerMessages: OwnerMessage[];
  /** One document per region; key = regionId (e.g. "0_0"). Incremental builds append to this doc. */
  documentsByRegion: Record<string, RegionDocument>;
  /** Current region's document id (mirrors documentsByRegion[regionId]?.documentId). */
  mainDocumentId: string | null;
  /** Current region's document MML (mirrors documentsByRegion[regionId]?.mml). */
  mainDocumentMml: string;
  lastTickSentChat: boolean;
  /** Last chat message we sent; used to show in prompt and avoid repeating. Cleared when new message addressing us arrives. */
  lastAgentChatMessage: string | null;
  /** UserId of whoever last @mentioned the agent or spoke as owner; used for owner-gating builds. */
  lastTriggerUserId: string | null;
  /** Agent's world position when in same region (set from get_occupants when self has position). */
  myPosition: Position3 | null;
  /** Last build location to walk toward; stop when close (~2 m). Cleared when no active target. */
  lastBuildTarget: BuildTarget | null;
  /** Last tool name that was run (so we can tell the LLM not to repeat it immediately). */
  lastToolRun: string | null;
};

/** Create initial state for a given region. */
export function createInitialState(regionId: string): ClawState {
  return {
    regionId,
    mySessionId: null,
    occupants: [],
    chat: [],
    lastError: null,
    ownerMessages: [],
    documentsByRegion: {},
    mainDocumentId: null,
    mainDocumentMml: "",
    lastTickSentChat: false,
    lastAgentChatMessage: null,
    lastTriggerUserId: null,
    myPosition: null,
    lastBuildTarget: null,
    lastToolRun: null,
  };
}

/** Sync mainDocumentId and mainDocumentMml from the current region's document. Call after join_region or when updating a region's doc. */
export function syncMainDocumentFromRegion(state: ClawState): void {
  const doc = state.documentsByRegion[state.regionId];
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

/** Set last error (e.g. region_boundary). Optional regionId for join_region hint. */
export function setLastError(
  state: ClawState,
  code: string,
  message: string,
  regionId?: string
): void {
  state.lastError = { code, message, regionId };
}
