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
  type SnapshotEntity,
  type WorldSnapshot,
} from "./client.js";

export { createAgentClient, type AgentClientOptions } from "./agentClient.js";

export {
  AGENT_WS_DEFAULT_PATH,
  getAgentWsUrl,
  isAgentWsAuthenticated,
  isAgentWsChat,
  isAgentWsError,
  isAgentWsHeartbeat,
  type AgentWsAuthenticatedMessage,
  type AgentWsChatMessage,
  type AgentWsChatServerMessage,
  type AgentWsClientMessage,
  type AgentWsEmoteMessage,
  type AgentWsThinkingMessage,
  type AgentWsThinkingServerMessage,
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

export {
  getBlockCatalog,
  listCatalog,
  getEngineCatalog,
  blockCatalogMutationUrls,
  normalizeCatalogEntry,
  catalogEntryId,
  type CatalogEntry,
  type CatalogPublicEntry,
  type ListCatalogParams,
} from "./catalog.js";
