/**
 * LLM provider abstraction. Implement LlmProvider and register in createLlmProvider.
 */

import type { LanguageModel } from "ai";
import type { ClawConfig } from "../config/config.js";
import type { Usage } from "./usage.js";
import { OpenRouterProvider } from "./providers/openrouterProvider.js";
import { GoogleGenAiApiProvider } from "./providers/googleGenAiApiProvider.js";
import { GoogleGenAiVertexProvider } from "./providers/googleGenAiVertexProvider.js";

export type CompletionResult =
  | { ok: true; content: string; usage: Usage | null }
  | { ok: false; error: string };

export type BuildIntentResult = {
  proceduralKind: "city" | "pyramid" | null;
  requiresBuildAction: boolean;
};

/** Both Gemini backends use kind "google" for hub/credits. */
export type LlmProviderKind = "openrouter" | "google";

export interface LlmProvider {
  readonly kind: LlmProviderKind;
  /**
   * Base USD cost before hub markup. Return null so hub uses OpenRouter model pricing.
   * Google providers return a positive number from token counts — hub must not call getModelPricing.
   */
  usageCostUsdBeforeMarkup(usage: Usage, modelId: string): number | null;
  getChatModel(modelId: string): LanguageModel | null;
  complete(options: {
    model: string;
    system: string;
    user: string;
    maxOutputTokens?: number;
    temperature?: number;
  }): Promise<CompletionResult>;
  classifyBuildIntent(message: string, modelId: string): Promise<BuildIntentResult>;
}

const PROVIDERS = {
  openrouter: (c: ClawConfig) => new OpenRouterProvider(c),
  google: (c: ClawConfig) => new GoogleGenAiApiProvider(c),
  "google-vertex": (c: ClawConfig) => new GoogleGenAiVertexProvider(c),
} as const;

export function createLlmProvider(config: ClawConfig): LlmProvider {
  return PROVIDERS[config.llmProvider](config);
}
