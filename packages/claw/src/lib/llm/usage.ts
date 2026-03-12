/**
 * Token usage shape for hub credit reporting.
 * OpenRouter chat/completions and AI SDK both feed into this; Google Gen AI maps via usageFromGoogle in googleGenAiBase.
 */
export type Usage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

/** Map Vercel AI SDK usage to hub Usage (same shape as OpenRouter). */
export function usageFromAiSdk(u: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
} | undefined): Usage | null {
  if (!u) return null;
  const total = u.totalTokens ?? (u.inputTokens ?? 0) + (u.outputTokens ?? 0);
  if (total <= 0) return null;
  return {
    prompt_tokens: u.inputTokens ?? 0,
    completion_tokens: u.outputTokens ?? 0,
    total_tokens: total,
  };
}
