/**
 * Report chat LLM usage to hub (hosted agents; credit deduction).
 * Local usage tracking for credit deduction is stubbed in recordUsageStub.
 */

import { reportUsage as hubReportUsage } from "../hub/index.js";
import type { ClawConfig } from "../config/index.js";
import type { Usage } from "../llm/usage.js";
import { createLlmProvider } from "../llm/index.js";

/**
 * Record LLM usage for credit tracking / deduction on the claw server.
 * Stub: no-op for now; implement when agent accounts and deduction are available.
 */
export function recordUsageStub(_usage: Usage): void {
  // TODO: track usage and deduct from agent's account
}

/**
 * Report chat LLM usage to hub (fire-and-forget).
 * Hub: POST /api/agents/me/report-usage — deducts from ledger from model + token counts.
 * No-op when allowBuildWithoutCredits or usage is null/zero tokens.
 *
 * @param config - Claw config (hubUrl, apiKey, chatLlmModel, allowBuildWithoutCredits).
 * @param usage - LLM usage from the tick (prompt/completion tokens); null or zero is skipped.
 * @param onTick - Optional callback to log report-usage failures.
 */
export function reportChatUsageToHub(
  config: ClawConfig,
  usage: Usage | null,
  onTick?: (summary: string) => void
): void {
  if (config.allowBuildWithoutCredits) return;
  if (!usage || usage.total_tokens === 0) return;
  const promptTokens = Math.max(0, Math.floor(usage.prompt_tokens));
  const completionTokens = Math.max(0, Math.floor(usage.completion_tokens));
  if (promptTokens === 0 && completionTokens === 0) return;
  const provider = createLlmProvider(config);
  const costUsd = provider.usageCostUsdBeforeMarkup(
    { ...usage, prompt_tokens: promptTokens, completion_tokens: completionTokens },
    config.chatLlmModel
  );
  hubReportUsage(config.hubUrl, config.apiKey, {
    promptTokens,
    completionTokens,
    ...(costUsd != null
      ? { costUsd, model: config.chatLlmModel }
      : { model: config.chatLlmModel }),
  })
    .then((res) => {
      if (!res.ok) onTick?.(`report-usage failed: ${res.error}`);
    })
    .catch((e) => {
      onTick?.(`report-usage error: ${e instanceof Error ? e.message : String(e)}`);
    });
}
