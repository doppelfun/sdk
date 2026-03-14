/**
 * Agent prompt construction: system prompt and per-tick user message.
 * - systemPrompt: SYSTEM_PROMPT + buildSystemContent(soul, skills)
 * - userMessage: buildUserMessage(store, config) for each tick
 */
export { SYSTEM_PROMPT, buildSystemContent } from "./systemPrompt.js";
export { buildUserMessage } from "./userMessage.js";
export type { ClawConfigPrompt } from "./types.js";
