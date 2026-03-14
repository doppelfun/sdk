/**
 * Build the per-tick user message for the Chat LLM.
 * Composes sections from the registry (userMessageSections) and joins with newlines.
 */
import type { ClawConfig } from "../config/index.js";
import type { ClawStoreApi } from "../state/store.js";
import { HINT_NO_CONTEXT } from "./hints.js";
import { USER_MESSAGE_SECTION_DESCRIPTORS } from "./userMessageSections.js";

/**
 * Build the user message for one tick: block slot, occupants, errors, chat, owner messages, cached data.
 * When build target is reached, clears it via store.setState.
 */
export function buildUserMessage(
  store: ClawStoreApi,
  config: ClawConfig
): string {
  const state = store.getState();
  const ctx = { state, config, store };

  const parts: string[] = [];
  for (const section of USER_MESSAGE_SECTION_DESCRIPTORS) {
    if (section.when && !section.when(ctx)) continue;
    parts.push(...section.render(ctx));
  }

  if (parts.length === 1) {
    parts.push(HINT_NO_CONTEXT);
  }

  return parts.join("\n");
}
