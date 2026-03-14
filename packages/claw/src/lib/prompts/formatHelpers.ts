/**
 * Helpers to format chat entries and "current + earlier" blocks for the user message.
 */
import type { ChatEntry, ClawState } from "../state/state.js";
import { isDmChannel } from "../../util/dm.js";

/**
 * Format one chat entry for the user prompt (global vs DM thread hints).
 * DM lines include targetSessionId so the model replies in-thread.
 */
export function formatChatEntryLine(state: ClawState, c: ChatEntry): string {
  const from = `From ${c.username}: ${c.message}`;
  if (!isDmChannel(c.channelId) || !state.mySessionId) return from;
  const peer =
    c.sessionId && c.sessionId !== state.mySessionId
      ? c.sessionId
      : state.lastDmPeerSessionId;
  if (!peer) return from;
  return `${from} (DM — reply with chat text="..." targetSessionId="${peer}"; channelId=${c.channelId})`;
}

/**
 * Append "current only" + optional "earlier context only" blocks.
 * Same pattern for chat and owner message stacks.
 */
export function pushCurrentAndEarlier<T>(
  parts: string[],
  items: T[],
  format: (item: T) => string,
  currentLabel: string,
  earlierLabel: string,
  options?: { earlierJoiner?: string; earlierSuffix?: string }
): void {
  if (items.length === 0) return;
  const joiner = options?.earlierJoiner ?? " | ";
  const suffix = options?.earlierSuffix ?? "";
  const last = items[items.length - 1]!;
  parts.push(`${currentLabel} ${format(last)}`);
  if (items.length > 1) {
    const earlier = items.slice(0, -1).map(format).join(joiner);
    parts.push(`${earlierLabel} ${earlier}${suffix}`);
  }
}
