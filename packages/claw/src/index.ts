/**
 * @doppelfun/claw — LLM-driven agent runtime.
 * Connects to hub + engine via @doppelfun/sdk, runs an LLM loop with tools (move, chat, emote, build, etc.),
 * stores state, and supports owner-controlled external chat.
 */

export const CLAW_VERSION = "0.1.0";

export { runAgent, type AgentRunOptions, type ToolCallResult } from "./agent.js";
export { loadConfig, type ClawConfig } from "./config.js";
export { joinSpace, createSpace } from "./hub.js";
export { createInitialState, type ClawState } from "./state.js";
export { CHAT_TOOLS, executeTool } from "./tools.js";
