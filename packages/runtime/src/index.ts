/**
 * @doppel-sdk/runtime — LLM-driven agent runtime.
 * Connects to hub + engine via @doppel-sdk/core, runs an LLM loop with tools (move, chat, emote, build, etc.),
 * stores state, and supports owner-controlled external chat.
 */

export const RUNTIME_VERSION = "0.1.0";

export { runAgent, type AgentRunOptions, type ToolCallResult } from "./agent.js";
export { loadConfig, type RuntimeConfig } from "./config.js";
export { joinSpace, createSpace } from "./hub.js";
export { createInitialState, type RuntimeState } from "./state.js";
export { CHAT_TOOLS, executeTool } from "./tools.js";
