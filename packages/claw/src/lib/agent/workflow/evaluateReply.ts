/**
 * Evaluator for reply action after an LLM tick: decide if we owe a reply and what to send.
 * Single place for DM fallback, DM ack after tools, and error-reply fallback.
 * @see docs/PLAN-WORKFLOW-PATTERNS.md Phase 2
 */

import type { ClawState } from "../../state/state.js";
import type { ReplyAction, LlmResultForReply } from "./types.js";
import { truncatePreview } from "../../log.js";

const DEFAULT_DM_FALLBACK = "Hey — I'm here.";
const DEFAULT_DM_ACK = "On my way!";
const DEFAULT_ERROR_REPLY =
  "Something went wrong on the server. If it keeps happening, try again in a moment.";

/**
 * Decide whether we should send a reply after this LLM turn and with what text.
 * Input: state (pending flags, last peer) and llmResult (hadToolCalls, replyText).
 * Output: none or send with text, targetSessionId, and optional log label.
 */
export function evaluateReplyAction(
  state: ClawState,
  llmResult: LlmResultForReply
): ReplyAction {
  const replyText = (llmResult.replyText ?? "").trim();
  const hasReplyText = replyText.length > 0;

  // DM fallback: we owed a DM reply but the model returned no tool calls (e.g. text-only).
  if (state.dmReplyPending && !llmResult.hadToolCalls && state.lastDmPeerSessionId) {
    const text = hasReplyText ? replyText.slice(0, 500) : DEFAULT_DM_FALLBACK;
    return {
      action: "send",
      text,
      targetSessionId: state.lastDmPeerSessionId,
      logLabel: `dm fallback chat: ${truncatePreview(text)}`,
    };
  }

  // DM ack: model used tools (e.g. move) but didn't send chat — send brief ack so user sees a response.
  if (
    state.dmReplyPending &&
    llmResult.hadToolCalls &&
    state.lastDmPeerSessionId &&
    !state.lastTickSentChat
  ) {
    const text = hasReplyText ? replyText.slice(0, 500) : DEFAULT_DM_ACK;
    return {
      action: "send",
      text,
      targetSessionId: state.lastDmPeerSessionId,
      logLabel: `dm ack after tools: ${truncatePreview(text)}`,
    };
  }

  // Error fallback: summarize lastError in plain language (DM or global).
  if (state.errorReplyPending && !llmResult.hadToolCalls) {
    const text = hasReplyText ? replyText.slice(0, 500) : DEFAULT_ERROR_REPLY;
    return {
      action: "send",
      text,
      targetSessionId: state.lastDmPeerSessionId ?? null,
      logLabel: `error-reply fallback chat: ${truncatePreview(text)}`,
    };
  }

  return { action: "none" };
}
