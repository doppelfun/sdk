/**
 * Agent WebSocket: URL builder and message types for move, chat, join.
 */

import { toWsBase } from "./utils.js";

/** Default Agent WebSocket path when attached to the main server (e.g. single port). */
export const AGENT_WS_DEFAULT_PATH = "/connect";

/**
 * Build the Agent WebSocket URL without token (auth via { type: "auth", token } after connect).
 * Use this to avoid the engine creating two sessions (one from ?token=, one from auth message).
 */
export function getAgentWsUrlWithoutToken(
  engineUrl: string,
  path: string = AGENT_WS_DEFAULT_PATH
): string {
  const wsBase = toWsBase(engineUrl);
  const pathNorm = path.startsWith("/") ? path : `/${path}`;
  return `${wsBase}${pathNorm}`;
}

/**
 * Build the Agent WebSocket URL with JWT in query. Use with any WebSocket client (browser or Node).
 * Prefer connecting without token and sending auth after connect to avoid duplicate sessions.
 */
export function getAgentWsUrl(
  engineUrl: string,
  path: string = AGENT_WS_DEFAULT_PATH,
  token: string
): string {
  const wsBase = toWsBase(engineUrl);
  const pathNorm = path.startsWith("/") ? path : `/${path}`;
  return `${wsBase}${pathNorm}?token=${encodeURIComponent(token)}`;
}

// --- Outbound (client → server) ---

export type AgentWsInputMessage = {
  type: "input";
  moveX?: number;
  moveZ?: number;
  sprint?: boolean;
  jump?: boolean;
  /** When stationary (moveX/moveZ zero), optional facing in radians (Y rotation). */
  rotY?: number;
};

export type AgentWsChatMessage = {
  type: "chat";
  text: string;
  /** When set, message is sent only to this session (DM). Omit for global/region chat. */
  targetSessionId?: string;
  /** Optional TTS voice id (e.g. ElevenLabs voice_id). Set via CLAW_VOICE_ID so each agent has a unique voice. */
  voiceId?: string;
  /**
   * When true, global chat is broadcast to the room but not written to chat_messages (agents only; ignored for DMs).
   * Use for transient lines (e.g. activity status blurbs) so history APIs stay clean.
   */
  ephemeral?: boolean;
};

export type AgentWsJoinMessage = {
  type: "join";
  regionId: string;
};

/** Emote by catalog id (e.g. wave, heart, dance). Server validates with isValidEmoteId. */
export type AgentWsEmoteMessage = {
  type: "emote";
  emoteId: string;
};

/**
 * Toggle "thinking" indicator for this session (LLM/agent working).
 * Server broadcasts to the room so clients can show a thinking state on the avatar.
 */
export type AgentWsThinkingMessage = {
  type: "thinking";
  /** true = started thinking, false = finished */
  thinking: boolean;
};

/** Request TTS for this text. Engine runs TTS and publishes to LiveKit when someone is nearby. */
export type AgentWsSpeakMessage = {
  type: "speak";
  text: string;
  /** Optional voice id for TTS (e.g. ElevenLabs voice_id). */
  voiceId?: string;
};

/** Server-driven move to (x, z). x, z are block-local 0–100. Server pathfinds and applies movement each tick; no waypoints sent to client. */
export type AgentWsMoveToMessage = {
  type: "move_to";
  x: number;
  z: number;
};

/** Cancel current server-driven move_to (e.g. when owner tells agent to stop). */
export type AgentWsCancelMoveMessage = {
  type: "cancel_move";
};

/** Follow another occupant by sessionId. Server re-paths to target's position periodically. No stop; use approach for conversation range. */
export type AgentWsFollowMessage = {
  type: "follow";
  targetSessionId: string;
};

/** Cancel current follow (stop following). */
export type AgentWsCancelFollowMessage = {
  type: "cancel_follow";
};

/** Approach another occupant by sessionId; server stops when within stopDistanceM and sends approach_arrived (e.g. conversation range). */
export type AgentWsApproachMessage = {
  type: "approach";
  targetSessionId: string;
  stopDistanceM: number;
};

/** Cancel current approach. */
export type AgentWsCancelApproachMessage = {
  type: "cancel_approach";
};

/** All outbound Agent WebSocket message types. Send as JSON after receiving `authenticated`. */
export type AgentWsClientMessage =
  | AgentWsInputMessage
  | AgentWsChatMessage
  | AgentWsJoinMessage
  | AgentWsEmoteMessage
  | AgentWsThinkingMessage
  | AgentWsSpeakMessage
  | AgentWsMoveToMessage
  | AgentWsCancelMoveMessage
  | AgentWsFollowMessage
  | AgentWsCancelFollowMessage
  | AgentWsApproachMessage
  | AgentWsCancelApproachMessage;

// --- Inbound (server → client) ---

export type AgentWsAuthenticatedMessage = {
  type: "authenticated";
  regionId: string;
  userId: string;
};

export type AgentWsJoinedMessage = {
  type: "joined";
  regionId: string;
};

export type AgentWsErrorMessage = {
  type: "error";
  error: string;
  code?: string;
};

export type AgentWsHeartbeatMessage = {
  type: "heartbeat";
  timestamp: number;
};

/** Inbound chat message (server → client). Includes channelId for filtering (global vs DM). */
/** Server broadcast: sessionId is thinking (LLM/NPC working). */
export type AgentWsThinkingServerMessage = {
  type: "thinking";
  sessionId: string;
  thinking: boolean;
};

/** @deprecated Server no longer sends waypoints; movement is driven by move_to (server pathfinds and applies input each tick). */
export type AgentWsWaypointsMessage = {
  type: "waypoints";
  waypoints: { x: number; z: number }[];
};

export type AgentWsChatServerMessage = {
  type: "chat";
  id?: string;
  sessionId?: string;
  username?: string;
  text?: string;
  timestamp?: number;
  /** "global" or dm:sessionA:sessionB. Use to filter or bucket by channel. */
  channelId?: string;
  mentions?: Array<{ sessionId?: string; userId?: string; username?: string }>;
};

/** Sent when move_to had no path; agent can tell the user the location is unreachable. */
export type AgentWsMoveToFailedMessage = {
  type: "move_to_failed";
  x: number;
  z: number;
};

/** Sent when follow failed (target left or no path). */
export type AgentWsFollowFailedMessage = {
  type: "follow_failed";
  targetSessionId: string;
};

/** Sent when follow had stopDistanceM and follower reached that distance to target (e.g. approach for conversation). */
export type AgentWsApproachArrivedMessage = {
  type: "approach_arrived";
  targetSessionId: string;
};

/**
 * Inbound Agent WebSocket messages. Movement: client sends move_to(x,z); server pathfinds and drives movement each tick (no waypoints sent back).
 * move_to_failed: server sends when no path; agent can inform user.
 * follow_failed: server sends when follow target left or no path.
 * approach_arrived: server sends when follow with stopDistanceM reached range.
 */
export type AgentWsServerMessage =
  | AgentWsAuthenticatedMessage
  | AgentWsJoinedMessage
  | AgentWsErrorMessage
  | AgentWsHeartbeatMessage
  | AgentWsThinkingServerMessage
  | AgentWsChatServerMessage
  | AgentWsMoveToFailedMessage
  | AgentWsFollowFailedMessage
  | AgentWsApproachArrivedMessage;

export function isAgentWsAuthenticated(msg: AgentWsServerMessage): msg is AgentWsAuthenticatedMessage {
  return msg.type === "authenticated";
}

export function isAgentWsError(msg: AgentWsServerMessage): msg is AgentWsErrorMessage {
  return msg.type === "error";
}

export function isAgentWsHeartbeat(msg: AgentWsServerMessage): msg is AgentWsHeartbeatMessage {
  return msg.type === "heartbeat";
}

export function isAgentWsChat(msg: AgentWsServerMessage): msg is AgentWsChatServerMessage {
  return msg.type === "chat";
}
