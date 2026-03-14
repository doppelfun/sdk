/**
 * Shared types for the agent loop: options, bootstrap, and WS message payloads.
 */

/**
 * Result of a single tool execution (from executeTool).
 * Either ok with optional summary, or not ok with error string.
 */
export type ToolCallResult =
  | { ok: true; summary?: string }
  | { ok: false; error: string };

/**
 * Options passed to runAgent.
 * Callbacks for lifecycle and logging; overrides for soul, skills, and skillIds.
 */
export type AgentRunOptions = {
  /** Called when the agent connects (after authenticated). */
  onConnected?: (blockSlotId: string, engineUrl: string) => void;
  /** Called when the agent disconnects or errors. */
  onDisconnect?: (err?: Error) => void;
  /** Called each tick with a short log line. */
  onTick?: (summary: string) => void;
  /** Called after each tool execution (name, args JSON, result). */
  onToolCallResult?: (name: string, args: string, result: ToolCallResult) => void;
  /** Override soul (skips API fetch when set). */
  soul?: string | null;
  /** Override skills (skips API fetch when set). */
  skills?: string | null;
  /** Skill IDs to request from GET /api/skills (overrides config when set). */
  skillIds?: string[];
};

/**
 * Response from GET /api/agents/me.
 * Profile, soul, and default block (defaultBlock / defaultSpace / default_space_id).
 */
export type AgentBootstrapResponse = {
  hosted?: boolean;
  soul?: string | null;
  defaultBlock?: { blockId: string; serverUrl: string | null } | null;
  defaultSpace?: { blockId: string; serverUrl: string | null } | null;
  default_space_id?: string | null;
};

/**
 * Skill entry from GET /api/skills (ids=...).
 * name (or id) identifies the skill; content is the skill text.
 */
export type SkillEntry = { name?: string; id?: string; content?: string };

/**
 * Payload for WebSocket "chat" messages from the engine.
 * userId is always set by the server; channelId is "global" or dm:sessionA:sessionB.
 */
export type ChatPayload = {
  username?: string;
  message?: string;
  text?: string;
  createdAt?: number;
  timestamp?: number;
  userId: string;
  sessionId?: string;
  channelId?: string;
  targetSessionId?: string;
  audioDurationMs?: number;
};

/**
 * Payload for WebSocket "error" messages from the engine.
 */
export type ErrorPayload = { code?: string; error?: string; regionId?: string };
