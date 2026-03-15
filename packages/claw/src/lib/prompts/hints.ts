/**
 * Hint strings and constants used when building the per-tick user message.
 * Centralized so copy stays consistent and sections can reference them by name.
 */

/** Shown when occupants are already in context. */
export const HINT_HAVE_OCCUPANTS =
  " (Do not call get_occupants again; you have the list.)";

/** Shown when chat history is already in context. */
export const HINT_HAVE_CHAT =
  " (Do not call get_chat_history again; you have it.)";

/** When list_catalog result is cached (compact only). */
export const HINT_HAVE_CATALOG =
  " (Compact cache only—call list_catalog again if you need more entries or full JSON.)";

/** When list_documents result is cached. */
export const HINT_HAVE_DOCUMENTS =
  " (Use this list to answer; do not call list_documents again unless the current message asks to refresh or you just created/deleted a document.)";

/** Default instruction for when to reply. */
export const HINT_WHEN_TO_REPLY =
  "Only reply when a line is marked '(DM)' or Owner said has an instruction. Otherwise skip chat and tool calls if nothing to do.";

/** Only owner can give movement commands. */
export const HINT_MOVE_COORDINATES =
  "Only the owner can tell you where to go. Do not call approach_position or approach_person unless the current message is from 'Owner said' asking you to go somewhere or approach someone. If a non-owner asks you to move, politely reply that only your owner can give you movement commands.";

const MOVE_TO_COORDS_REGEX = /\b(?:move|go|head|walk)\s+to\s+(\d+(?:\.\d*)?)\s*,\s*(\d+(?:\.\d*)?)\b/i;
const BLOCK_COORD_MAX = 100;

/**
 * If the message is a "move to X, Y" request (block-local 0–100), return the exact instruction for the approach_position tool.
 */
export function getMoveToCoordsInstruction(message: string): string | null {
  const match = message.match(MOVE_TO_COORDS_REGEX);
  if (!match) return null;
  const x = parseFloat(match[1]!);
  const z = parseFloat(match[2]!);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  if (x < 0 || x > BLOCK_COORD_MAX || z < 0 || z > BLOCK_COORD_MAX) return null;
  return `Call the approach_position tool with position: '${x},${z}'.`;
}

/** Fallback when no other context. */
export const HINT_NO_CONTEXT =
  "No context yet. Call get_occupants or get_chat_history once to gather context, then act or wait.";

/** Build tools that must not be called twice back-to-back in the same session turn. */
export const BUILD_TOOLS_NO_REPEAT = new Set<string>([
  "build_full",
  "build_with_code",
  "build_incremental",
]);

/** Cap injected catalog bytes so wake ticks stay bounded. */
export const MAX_INJECT_CATALOG_CHARS = 3200;

/**
 * Instruction when we have a stored last reply (so the model does not repeat).
 */
export function hintAlreadyReplied(lastMessage: string | null): string {
  if (lastMessage) {
    return `Your last reply was: "${lastMessage}". Do not repeat yourself: do not send the same or nearly the same message again. Only reply when there is a *new* DM or owner message, and say something different (e.g. answer the question, add new info, or wrap up).`;
  }
  return "You already replied in chat last tick. Do not repeat—only reply again if there is a *new* DM or owner message, and say something different.";
}
