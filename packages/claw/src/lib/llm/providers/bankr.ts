/**
 * Bankr LLM Gateway provider (https://llm.bankr.bot).
 * OpenAI-compatible API; auth via X-API-Key header.
 */
import type { LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { ClawConfig } from "../../config/index.js";

const BANKR_LLM_BASE_URL = "https://llm.bankr.bot/v1";

let cachedProvider: ReturnType<typeof createOpenAI> | null = null;
let cachedApiKey: string | null = null;

function getProvider(apiKey: string): ReturnType<typeof createOpenAI> {
  if (!cachedProvider || cachedApiKey !== apiKey) {
    cachedProvider = createOpenAI({
      baseURL: BANKR_LLM_BASE_URL,
      headers: { "X-API-Key": apiKey },
    });
    cachedApiKey = apiKey;
  }
  return cachedProvider;
}

export function getBankrLanguageModel(
  config: ClawConfig,
  modelId: string
): LanguageModel | null {
  const apiKey = config.bankrLlmApiKey?.trim();
  if (!apiKey) return null;
  const provider = getProvider(apiKey);
  return provider.chat(modelId) as unknown as LanguageModel;
}
