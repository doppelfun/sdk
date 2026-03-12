/**
 * Chat history HTTP API: fetch messages and pagination.
 */

import { fetchJson, normalizeBaseUrl } from "./utils.js";

export type ChatHistoryMessage = {
  username: string;
  message: string;
  createdAt: number;
  /** "global" or dm-user:idA:idB. Present when server supports channels. */
  channelId?: string;
};

export type GetChatHistoryResult = {
  messages: ChatHistoryMessage[];
  hasMore: boolean;
};

export type GetChatHistoryOptions = {
  /** Max messages (1–500). Default 100. */
  limit?: number;
  /** Unix ms; return messages before this time (pagination). */
  before?: number;
  /** When set, return only messages for this region; omit for global (e.g. observer) history. */
  regionId?: string | null;
  /** When set, return only messages in this channel (e.g. "global" or dm-user:idA:idB). */
  channelId?: string | null;
};

const CHAT_LIMIT_MIN = 1;
const CHAT_LIMIT_MAX = 500;
const CHAT_LIMIT_DEFAULT = 100;

/**
 * Fetch chat history. Requires a session token (e.g. from POST /api/session with Bearer JWT).
 * Poll with optional `before` (e.g. latest createdAt) to "listen" for new messages.
 */
export async function getChatHistory(
  engineUrl: string,
  sessionToken: string,
  options: GetChatHistoryOptions = {}
): Promise<GetChatHistoryResult> {
  const base = normalizeBaseUrl(engineUrl);
  const limit = Math.min(CHAT_LIMIT_MAX, Math.max(CHAT_LIMIT_MIN, options.limit ?? CHAT_LIMIT_DEFAULT));
  const params = new URLSearchParams({ limit: String(limit) });
  if (options.before != null && Number.isFinite(options.before)) {
    params.set("before", String(options.before));
  }
  if (options.regionId != null && options.regionId !== "") {
    params.set("regionId", options.regionId);
    params.set("blockSlotId", options.regionId);
  }
  if (options.channelId != null && options.channelId !== "") {
    params.set("channelId", options.channelId);
  }
  const data = await fetchJson<{ messages: ChatHistoryMessage[]; hasMore?: boolean }>(
    `${base}/api/chat?${params}`,
    { headers: { Authorization: `Bearer ${sessionToken}` } },
    "GET /api/chat"
  );
  return { messages: data.messages, hasMore: data.hasMore ?? false };
}
