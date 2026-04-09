/** Options for client.sendChat (DM target, voice, ephemeral global). */
export type ChatSendOptions = { targetSessionId?: string; voiceId?: string; ephemeral?: boolean };

/**
 * Build sendChat options from targetSessionId and voiceId. Returns undefined if all empty.
 *
 * @param opts - targetSessionId, voiceId, ephemeral (optional)
 * @returns ChatSendOptions or undefined
 */
export function buildChatSendOptions(opts: {
  targetSessionId?: string;
  voiceId?: string | null;
  ephemeral?: boolean;
}): ChatSendOptions | undefined {
  const targetSessionId = opts.targetSessionId?.trim();
  const voiceId = typeof opts.voiceId === "string" ? opts.voiceId.trim() || undefined : undefined;
  const ephemeral = opts.ephemeral === true;
  if (!targetSessionId && !voiceId && !ephemeral) return undefined;
  return {
    ...(targetSessionId && { targetSessionId }),
    ...(voiceId && { voiceId }),
    ...(ephemeral && { ephemeral: true }),
  };
}
