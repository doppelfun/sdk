/**
 * Gemini USD cost before hub markup — lives in claw so the hub never calls OpenRouter
 * pricing for Google/Vertex model ids. Tune rates against
 * https://ai.google.dev/gemini-api/docs/pricing
 */

import type { Usage } from "./usage.js";

type Rates = { promptPerToken: number; completionPerToken: number };

const RATES: Record<string, Rates> = {
  "gemini-2.5-flash": { promptPerToken: 0.3e-6, completionPerToken: 2.5e-6 },
  "gemini-2.5-flash-lite": { promptPerToken: 0.15e-6, completionPerToken: 1.2e-6 },
  "gemini-2.5-pro": { promptPerToken: 1.25e-6, completionPerToken: 10e-6 },
};

function ratesForModel(modelId: string): Rates {
  if (RATES[modelId]) return RATES[modelId]!;
  if (modelId.includes("flash-lite") || modelId.includes("flash_lite"))
    return RATES["gemini-2.5-flash-lite"]!;
  if (modelId.includes("pro")) return RATES["gemini-2.5-pro"]!;
  return RATES["gemini-2.5-flash"]!;
}

/**
 * Base USD cost from token counts (before hub markup). Used for report-usage when
 * LLM_PROVIDER is google/google-vertex so the hub does not look up OpenRouter pricing.
 */
export function geminiUsageCostUsd(usage: Usage, modelId: string): number {
  const r = ratesForModel(modelId);
  const p = Math.max(0, usage.prompt_tokens);
  const c = Math.max(0, usage.completion_tokens);
  return p * r.promptPerToken + c * r.completionPerToken;
}
