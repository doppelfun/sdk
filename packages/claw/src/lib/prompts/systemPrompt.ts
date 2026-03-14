/**
 * System prompt assembly: join parts (from templates or fallbacks) and append soul + skills.
 */
import { getSystemPromptParts } from "./systemPromptParts.js";
import type { ClawConfigPrompt } from "./types.js";

/** Full system prompt for the Chat LLM (all parts joined). Loaded once at module init. */
export const SYSTEM_PROMPT = getSystemPromptParts().join("\n\n");

/**
 * Build full system message: base SYSTEM_PROMPT + soul + skills.
 */
export function buildSystemContent(clawConfig: ClawConfigPrompt): string {
  let content = SYSTEM_PROMPT;
  if (clawConfig.soul && clawConfig.soul.trim()) {
    content += "\n\n" + clawConfig.soul.trim();
  }
  if (clawConfig.skills && clawConfig.skills.trim()) {
    content += "\n\n---\n\nSkills:\n\n" + clawConfig.skills.trim();
  }
  return content;
}
