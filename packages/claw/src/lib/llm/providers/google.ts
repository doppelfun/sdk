import type { LanguageModel } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { ClawConfig } from "../../config/index.js";

let cachedProvider: ReturnType<typeof createGoogleGenerativeAI> | null = null;

function getProvider(apiKey: string): ReturnType<typeof createGoogleGenerativeAI> {
  if (!cachedProvider) {
    cachedProvider = createGoogleGenerativeAI({ apiKey });
  }
  return cachedProvider;
}

export function getGoogleLanguageModel(config: ClawConfig, modelId: string): LanguageModel | null {
  const apiKey =
    config.googleApiKey?.trim() ||
    (typeof process !== "undefined" && process.env.GOOGLE_API_KEY?.trim()) ||
    (typeof process !== "undefined" && process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim());
  if (!apiKey) return null;
  const provider = getProvider(apiKey);
  return provider.chat(modelId) as unknown as LanguageModel;
}
