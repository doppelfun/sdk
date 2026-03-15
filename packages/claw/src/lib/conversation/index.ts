/** Agent-to-agent conversation FSM: turn-taking, receive delay, break conditions. */
export {
  canSendDmTo,
  evaluateSendReply,
  onWeSentDm,
  onWeReceivedDm,
  checkBreak,
  clearConversation,
  drainPendingReply,
  getConversationPeer,
  isInConversation,
  CONVERSATION_TIMEOUT_MS,
  CONVERSATION_MAX_ROUNDS,
  CONVERSATION_END_SEEK_COOLDOWN_MS,
  RECEIVE_REPLY_DELAY_MIN_MS,
  TTS_CHARS_PER_SECOND,
} from "./conversation.js";
export type { SendReplyAction } from "./conversation.js";
export type { ConversationPhase, ConversationStateSlice, CheckBreakOptions } from "./types.js";
