/**
 * Agent WebSocket: URL builder and message types for move, chat, join.
 */

import { toWsBase } from "./utils.js";

/** Default Agent WebSocket path when attached to the main server (e.g. single port). */
export const AGENT_WS_DEFAULT_PATH = "/connect";

/**
 * Build the Agent WebSocket URL with JWT in query. Use with any WebSocket client (browser or Node).
 * @param engineUrl - Engine base URL (e.g. https://your-app.railway.app or http://localhost:2567)
 * @param path - WS path (default AGENT_WS_DEFAULT_PATH)
 * @param token - Hub-issued JWT; added as ?token=...
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
};

export type AgentWsChatMessage = {
  type: "chat";
  text: string;
  /** When set, message is sent only to this session (DM). Omit for global/region chat. */
  targetSessionId?: string;
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

/** All outbound Agent WebSocket message types. Send as JSON after receiving `authenticated`. */
export type AgentWsClientMessage =
  | AgentWsInputMessage
  | AgentWsChatMessage
  | AgentWsJoinMessage
  | AgentWsEmoteMessage
  | AgentWsThinkingMessage;

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

/** All inbound Agent WebSocket message types. Parse JSON from the socket. */
export type AgentWsServerMessage =
  | AgentWsAuthenticatedMessage
  | AgentWsJoinedMessage
  | AgentWsErrorMessage
  | AgentWsHeartbeatMessage
  | AgentWsThinkingServerMessage
  | AgentWsChatServerMessage;

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
