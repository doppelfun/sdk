/**
 * System prompt assembly: soul first (with header), then system parts, then skills.
 */
import { getSystemPromptParts } from "./systemPromptParts.js";
import type { ClawConfigPrompt } from "./types.js";

/** Full system prompt for the Chat LLM (all parts joined). Loaded once at module init. */
export const SYSTEM_PROMPT = getSystemPromptParts().join("\n\n");

/** Header for the soul block. "Personality:" is widely recognized by models as character/identity definition. */
const SOUL_HEADER = "---\n\nPersonality:\n\n";

/**
 * Build full system message: soul (with header) first, then SYSTEM_PROMPT, then skills.
 */
export function buildSystemContent(clawConfig: ClawConfigPrompt): string {
  const parts: string[] = [];
  if (clawConfig.soul && clawConfig.soul.trim()) {
    parts.push(SOUL_HEADER + clawConfig.soul.trim());
  }
  parts.push(SYSTEM_PROMPT);
  if (clawConfig.skills && clawConfig.skills.trim()) {
    parts.push("---\n\nSkills:\n\n" + clawConfig.skills.trim());
  }
  return parts.join("\n\n");
}
