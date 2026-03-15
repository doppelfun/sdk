/**
 * Workflow types for the tick loop (reply evaluation, optional routing).
 * @see docs/PLAN-WORKFLOW-PATTERNS.md
 */

/** Result of the "act" step: LLM run outcome used to evaluate whether we need to send a reply. */
export type LlmResultForReply = {
  ok: true;
  hadToolCalls: boolean;
  replyText?: string | null;
};

/**
 * Output of evaluateReplyAction: either no reply, or send one with text and optional DM target.
 */
export type ReplyAction =
  | { action: "none" }
  | {
      action: "send";
      text: string;
      /** DM target session id, or null for global. */
      targetSessionId: string | null;
      logLabel?: string;
    };
