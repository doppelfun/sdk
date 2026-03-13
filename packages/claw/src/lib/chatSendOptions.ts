/**
 * Shared helpers for building options passed to client.sendChat.
 * Centralizes targetSessionId + voiceId so TTS uses the right voice (e.g. from CLAW_VOICE_ID).
 */

/**
 * Options for client.sendChat.
 * DM target and/or TTS voice id; omit keys when not set.
 */
export type ChatSendOptions = {
  targetSessionId?: string;
  voiceId?: string;
};

/**
 * Build options for client.sendChat.
 * Only includes targetSessionId/voiceId when provided and truthy.
 * Use config.voiceId (from CLAW_VOICE_ID) as default; override with tool args.voiceId when present.
 *
 * @param opts - Optional targetSessionId and voiceId (string or null).
 * @returns Object suitable for sendChat second argument, or undefined when both opts are empty.
 */
export function buildChatSendOptions(opts: {
  targetSessionId?: string;
  voiceId?: string | null;
}): ChatSendOptions | undefined {
  const targetSessionId = opts.targetSessionId?.trim();
  const voiceId = typeof opts.voiceId === "string" ? opts.voiceId.trim() || undefined : undefined;
  if (!targetSessionId && !voiceId) return undefined;
  return {
    ...(targetSessionId && { targetSessionId }),
    ...(voiceId && { voiceId }),
  };
}
