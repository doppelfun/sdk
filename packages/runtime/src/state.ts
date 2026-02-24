/**
 * In-memory runtime state for the agent loop.
 * Holds region, occupants, chat, errors, owner messages, and build state (mainDocumentId, mainDocumentMml).
 * Updated by WebSocket handlers (chat, error, joined, authenticated) and by executeTool (occupants, chat, lastError, etc.).
 */

import type { Occupant } from "@doppel-sdk/core";

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

export type RuntimeState = {
  regionId: string;
  mySessionId: string | null;
  occupants: Occupant[];
  chat: ChatEntry[];
  lastError: { code: string; message: string; regionId?: string } | null;
  ownerMessages: OwnerMessage[];
  mainDocumentId: string | null;
  mainDocumentMml: string;
  lastTickSentChat: boolean;
  /** Last chat message we sent; used to show in prompt and avoid repeating. Cleared when new message addressing us arrives. */
  lastAgentChatMessage: string | null;
};

/** Create initial state for a given region. */
export function createInitialState(regionId: string): RuntimeState {
  return {
    regionId,
    mySessionId: null,
    occupants: [],
    chat: [],
    lastError: null,
    ownerMessages: [],
    mainDocumentId: null,
    mainDocumentMml: "",
    lastTickSentChat: false,
    lastAgentChatMessage: null,
  };
}

/** Append chat entry; keep at most max. */
export function pushChat(state: RuntimeState, entry: ChatEntry, max: number): void {
  state.chat.push(entry);
  if (state.chat.length > max) state.chat.shift();
}

/** Append owner message; keep at most max. */
export function pushOwnerMessage(state: RuntimeState, text: string, max: number): void {
  state.ownerMessages.push({ text, at: Date.now() });
  if (state.ownerMessages.length > max) state.ownerMessages.shift();
}

/** Set last error (e.g. region_boundary). Optional regionId for join_region hint. */
export function setLastError(
  state: RuntimeState,
  code: string,
  message: string,
  regionId?: string
): void {
  state.lastError = { code, message, regionId };
}
