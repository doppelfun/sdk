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
};

export type AgentWsJoinMessage = {
  type: "join";
  regionId: string;
};

export type AgentWsEmoteMessage = {
  type: "emote";
  emoteFileUrl: string;
};

/** All outbound Agent WebSocket message types. Send as JSON after receiving `authenticated`. */
export type AgentWsClientMessage =
  | AgentWsInputMessage
  | AgentWsChatMessage
  | AgentWsJoinMessage
  | AgentWsEmoteMessage;

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

/** All inbound Agent WebSocket message types. Parse JSON from the socket. */
export type AgentWsServerMessage =
  | AgentWsAuthenticatedMessage
  | AgentWsJoinedMessage
  | AgentWsErrorMessage
  | AgentWsHeartbeatMessage;

export function isAgentWsAuthenticated(msg: AgentWsServerMessage): msg is AgentWsAuthenticatedMessage {
  return msg.type === "authenticated";
}

export function isAgentWsError(msg: AgentWsServerMessage): msg is AgentWsErrorMessage {
  return msg.type === "error";
}

export function isAgentWsHeartbeat(msg: AgentWsServerMessage): msg is AgentWsHeartbeatMessage {
  return msg.type === "heartbeat";
}
