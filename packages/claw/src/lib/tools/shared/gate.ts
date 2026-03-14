/**
 * Owner gate and balance/usage reporting for build tools.
 */

import type { ClawConfig } from "../../config/index.js";
import type { ClawState } from "../../state/index.js";
import { createLlmProvider } from "../../llm/index.js";
import type { Usage } from "../../llm/usage.js";
import { checkBalance, reportUsage as hubReportUsage } from "../../hub/index.js";

/**
 * Cheap heuristic: does the message look like a build request?
 * Used to fail fast (no LLM) when a non-owner asks to build and we can reply with owner-gate message.
 */
export function looksLikeBuildRequest(message: string): boolean {
  const m = message.trim();
  if (m.length < 4) return false;
  return (
    /^\s*(build|create|make|construct|generate)\b/i.test(m) ||
    /\b(build|create|make|construct|generate)\s+(a|an|the)?\s*(pyramid|city|house|tower|building|structure|something)\b/i.test(m)
  );
}

export function checkOwnerGate(config: ClawConfig, state: ClawState): string | null {
  if (!config.hosted) return null;
  if (!config.ownerUserId) return null;
  if (state.lastTriggerUserId === config.ownerUserId) return null;
  return "Only the owner can trigger builds";
}

export function ownerGateDenied(
  config: ClawConfig,
  state: ClawState
): { ok: false; error: string } | null {
  const err = checkOwnerGate(config, state);
  return err ? { ok: false, error: err } : null;
}

export async function preCheckBalance(config: ClawConfig): Promise<string | null> {
  if (!config.hosted) return null;
  if (config.allowBuildWithoutCredits) return null;
  const res = await checkBalance(config.hubUrl, config.apiKey);
  if (!res.ok) return `Balance check failed: ${res.error}`;
  if (!res.linked) return null;
  if (res.balance <= 0) {
    return (
      `Insufficient credits (balance ${res.balance}). ` +
      `Add credits on the hub, or set ALLOW_BUILD_WITHOUT_CREDITS=1 for local dev only.`
    );
  }
  return null;
}

export function reportBuildUsage(config: ClawConfig, usage: Usage | null): void {
  if (config.allowBuildWithoutCredits) return;
  if (!config.hosted || !usage || usage.total_tokens === 0) return;
  const promptTokens = Math.max(0, Math.floor(usage.prompt_tokens));
  let completionTokens = Math.max(0, Math.floor(usage.completion_tokens));
  const m = config.buildCreditMultiplier;
  if (m !== 1 && Number.isFinite(m) && m > 0) {
    completionTokens = Math.max(0, Math.floor(completionTokens * m));
  }
  if (promptTokens === 0 && completionTokens === 0) return;
  const provider = createLlmProvider(config);
  const usageForCost: Usage = {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  };
  const costUsd = provider.usageCostUsdBeforeMarkup(usageForCost, config.buildLlmModel);
  hubReportUsage(config.hubUrl, config.apiKey, {
    promptTokens,
    completionTokens,
    ...(costUsd != null
      ? { costUsd, model: config.buildLlmModel }
      : { model: config.buildLlmModel }),
  }).catch(() => {});
}
