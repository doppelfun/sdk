/**
 * System prompt parts: loaded from templates/*.md. Order is fixed; SYSTEM_PROMPT is built in systemPrompt.ts.
 */
import { loadTemplate } from "./templateLoader.js";

/** Part names under templates/ (without .md). SDK-only; engine/hub content lives in doppel-claw skill. */
const SYSTEM_PART_NAMES = [
  "system-role-and-chat",
  "system-when-to-reply",
  "system-runtime-and-tools",
  "system-context-and-current-message",
  "system-error-handling",
  "system-movement-and-autonomy",
] as const;

/** Load system prompt parts in order from template files. */
export function getSystemPromptParts(): string[] {
  return SYSTEM_PART_NAMES.map((name) => loadTemplate(name));
}
