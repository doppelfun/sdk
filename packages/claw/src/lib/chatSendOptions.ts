export type ChatSendOptions = { targetSessionId?: string; voiceId?: string };

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
