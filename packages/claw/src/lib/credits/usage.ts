/**
 * Credit usage: LLM token tracking, report to hub, optional pre-check.
 * Plan §5a. When hosted and !skipCreditReport, report after each LLM tick; on 402 treat as hard failure.
 */

import type { ClawConfig } from "../config/index.js";
import type { ClawStore } from "../state/index.js";
import type { Usage } from "../llm/usage.js";
import { reportUsage, reportVoiceUsage, checkBalance } from "../hub/index.js";
import { setCachedBalance } from "../hub/profile.js";

/** Minimum balance (credits) to allow an agent run when hosted. */
export const MIN_BALANCE_THRESHOLD = 0.1;

/**
 * Report LLM usage to hub (fire-and-forget). Updates cached balance when hub returns balanceAfter.
 * No-op when skipCreditReport or !hosted or usage is null/zero.
 */
export function reportUsageToHub(
  config: ClawConfig,
  store: ClawStore,
  usage: Usage | null,
  modelId: string,
  onFailure?: (message: string) => void
): void {
  if (config.skipCreditReport || !config.hosted) return;
  if (!usage || usage.total_tokens <= 0) return;
  const promptTokens = Math.max(0, Math.floor(usage.prompt_tokens));
  const completionTokens = Math.max(0, Math.floor(usage.completion_tokens));
  if (promptTokens === 0 && completionTokens === 0) return;

  reportUsage(config.agentApiUrl, config.apiKey, {
    promptTokens,
    completionTokens,
    model: modelId,
  })
    .then((res) => {
      if (res.ok && res.balanceAfter != null) {
        setCachedBalance(store, res.balanceAfter);
      }
      if (!res.ok) {
        const is402 = res.status === 402;
        onFailure?.(is402 ? "Credits exhausted; add credits to continue." : `report-usage failed: ${res.error}`);
      }
    })
    .catch((e) => {
      onFailure?.(`report-usage error: ${e instanceof Error ? e.message : String(e)}`);
    });
}

/**
 * True when we have enough credits to run an agent (hosted only).
 * Uses cached balance and daily budget from config; dailySpend from store.
 */
export function hasEnoughCredits(store: ClawStore, config: ClawConfig): boolean {
  if (!config.hosted || config.skipCreditReport) return true;
  const state = store.getState();
  if (state.cachedBalance < MIN_BALANCE_THRESHOLD) return false;
  if (config.dailyCreditBudget > 0 && state.dailySpend >= config.dailyCreditBudget) return false;
  return true;
}

/**
 * Fetch balance from hub and update store. Call on connect or periodically so HasEnoughCredits is accurate.
 */
export async function refreshBalance(
  store: ClawStore,
  config: ClawConfig
): Promise<{ ok: true; balance: number } | { ok: false; error: string }> {
  const res = await checkBalance(config.agentApiUrl, config.apiKey);
  if (!res.ok) return { ok: false, error: res.error };
  setCachedBalance(store, res.balance);
  return { ok: true, balance: res.balance };
}

/**
 * Report voice (TTS) character usage to hub. No-op when !hosted or !voiceEnabled or skipCreditReport.
 */
export function reportVoiceUsageToHub(
  config: ClawConfig,
  store: ClawStore,
  characters: number,
  onFailure?: (message: string) => void
): void {
  if (config.skipCreditReport || !config.hosted || !config.voiceEnabled) return;
  if (characters <= 0) return;
  reportVoiceUsage(config.agentApiUrl, config.apiKey, { characters })
    .then((res) => {
      if (res.ok && res.balanceAfter != null) {
        setCachedBalance(store, res.balanceAfter);
      }
      if (!res.ok) {
        const is402 = res.status === 402;
        onFailure?.(is402 ? "Credits exhausted (voice)." : `report voice usage failed: ${res.error}`);
      }
    })
    .catch((e) => {
      onFailure?.(`report voice error: ${e instanceof Error ? e.message : String(e)}`);
    });
}
