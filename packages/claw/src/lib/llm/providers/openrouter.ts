import type { LanguageModel } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

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

export function getOpenRouterLanguageModel(
  config: { openRouterApiKey?: string | null },
  modelId: string
): LanguageModel | null {
  const apiKey = config.openRouterApiKey?.trim();
  if (!apiKey) return null;
  const provider = getProvider(apiKey);
  return provider.chat(modelId) as unknown as LanguageModel;
}
