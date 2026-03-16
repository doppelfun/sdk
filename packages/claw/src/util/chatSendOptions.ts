/** Options for client.sendChat (DM target, voice). */
export type ChatSendOptions = { targetSessionId?: string; voiceId?: string };

/**
 * Build sendChat options from targetSessionId and voiceId. Returns undefined if both empty.
 *
 * @param opts - targetSessionId, voiceId (optional)
 * @returns ChatSendOptions or undefined
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
