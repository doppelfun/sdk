/**
 * Token usage shape for hub credit reporting.
 * OpenRouter chat/completions and AI SDK both feed into this; Google Gen AI maps via usageFromGoogle in googleGenAiBase.
 */
export type Usage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

/**
 * Map Vercel AI SDK usage to hub Usage (same shape as OpenRouter).
 * Derives total_tokens from totalTokens or inputTokens + outputTokens when absent.
 */
export function usageFromAiSdk(u: {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
} | undefined): Usage | null {
  if (!u) return null;
  const inTok = u.inputTokens ?? 0;
  const outTok = u.outputTokens ?? 0;
  const total = u.totalTokens ?? inTok + outTok;
  if (total <= 0) return null;
  return {
    prompt_tokens: inTok,
    completion_tokens: outTok,
    total_tokens: total,
  };
}
