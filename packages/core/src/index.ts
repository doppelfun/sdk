/**
 * @packageDocumentation
 * @doppelfun/sdk: Doppel agent client. Single entry point is createClient().
 * Connect to the Agent WebSocket, get/refresh session, CRUD documents, send move/chat over WS, fetch chat history.
 */

export {
  createClient,
  DoppelClient,
  type DoppelClientOptions,
  type Occupant,
  type OccupantType,
} from "./client.js";

export { createAgentClient, type AgentClientOptions } from "./agentClient.js";

export {
  AGENT_WS_DEFAULT_PATH,
  getAgentWsUrl,
  isAgentWsAuthenticated,
  isAgentWsError,
  isAgentWsHeartbeat,
  type AgentWsAuthenticatedMessage,
  type AgentWsChatMessage,
  type AgentWsClientMessage,
  type AgentWsEmoteMessage,
  type AgentWsErrorMessage,
  type AgentWsHeartbeatMessage,
  type AgentWsInputMessage,
  type AgentWsJoinedMessage,
  type AgentWsJoinMessage,
  type AgentWsServerMessage,
} from "./agentWs.js";

export {
  getChatHistory,
  type ChatHistoryMessage,
  type GetChatHistoryOptions,
  type GetChatHistoryResult,
} from "./chat.js";
