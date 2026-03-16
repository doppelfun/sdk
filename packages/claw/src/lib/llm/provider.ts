import type { LanguageModel } from "ai";
import type { ClawConfig } from "../config/index.js";
import { getOpenRouterLanguageModel } from "./providers/openrouter.js";
import { getGoogleLanguageModel } from "./providers/google.js";

export interface LlmProvider {
  getChatModel(modelId: string): LanguageModel | null;
}

export function createLlmProvider(config: ClawConfig): LlmProvider {
  return {
    getChatModel(modelId: string): LanguageModel | null {
      if (config.llmProvider === "google") {
        return getGoogleLanguageModel(config, modelId);
      }
      if (config.llmProvider === "openrouter") {
        return getOpenRouterLanguageModel(config, modelId);
      }
      // google-vertex: could add @ai-sdk/google-vertex later
      return null;
    },
  };
}
