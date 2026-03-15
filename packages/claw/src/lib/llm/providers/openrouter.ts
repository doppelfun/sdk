/**
 * Shared OpenRouter model access for the AI SDK.
 * Uses @openrouter/ai-sdk-provider so the provider and toolsAi fallback share one integration.
 *
 * @see https://www.npmjs.com/package/@openrouter/ai-sdk-provider
 * @see docs/PLAN-AI-SDK-REFACTOR.md
 */

import type { LanguageModel } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { ClawConfig } from "../../config/index.js";

/** Single OpenRouter provider instance (keyed by first apiKey used). */
let cachedProvider: ReturnType<typeof createOpenRouter> | null = null;

function getProvider(apiKey: string): ReturnType<typeof createOpenRouter> {
  if (!cachedProvider) {
    cachedProvider = createOpenRouter({
      apiKey,
      headers: { "HTTP-Referer": "https://github.com/doppel-sdk" },
    });
  }
  return cachedProvider;
}

/**
 * Return a LanguageModel for the given model ID using OpenRouter.
 * Used by OpenRouterProvider when LLM_PROVIDER=openrouter.
 */
export function getOpenRouterLanguageModel(
  config: Pick<ClawConfig, "openRouterApiKey">,
  modelId: string
): LanguageModel | null {
  const apiKey = config.openRouterApiKey?.trim();
  if (!apiKey) return null;
  const provider = getProvider(apiKey);
  return provider.chat(modelId) as unknown as LanguageModel;
}
