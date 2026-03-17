/** Token counts for reporting to hub / credits. */
export type Usage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

/**
 * Map AI SDK usage (inputTokens, outputTokens, totalTokens) to our Usage type.
 *
 * @param u - Raw usage from generateText / agent result
 * @returns Usage or null if missing or total <= 0
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
