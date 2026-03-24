/**
 * LLM provider abstraction: openrouter, google, bankr, venice (and optionally google-vertex).
 */
import type { LanguageModel } from "ai";
import type { ClawConfig } from "../config/index.js";
import { getOpenRouterLanguageModel } from "./providers/openrouter.js";
import { getGoogleLanguageModel } from "./providers/google.js";
import { getBankrLanguageModel } from "./providers/bankr.js";
import { getVeniceLanguageModel } from "./providers/venice.js";

/** Provider that returns a LanguageModel for a given model id. */
export interface LlmProvider {
  getChatModel(modelId: string): LanguageModel | null;
}

/**
 * Create the LLM provider for the current config (openrouter, google, bankr, venice, …).
 *
 * @param config - Claw config (llmProvider, API keys)
 * @returns LlmProvider
 */
export function createLlmProvider(config: ClawConfig): LlmProvider {
  return {
    getChatModel(modelId: string): LanguageModel | null {
      if (config.llmProvider === "google") {
        return getGoogleLanguageModel(config, modelId);
      }
      if (config.llmProvider === "openrouter") {
        return getOpenRouterLanguageModel(config, modelId);
      }
      if (config.llmProvider === "bankr") {
        return getBankrLanguageModel(config, modelId);
      }
      if (config.llmProvider === "venice") {
        return getVeniceLanguageModel(config, modelId);
      }
      // google-vertex: could add @ai-sdk/google-vertex later
      return null;
    },
  };
}
