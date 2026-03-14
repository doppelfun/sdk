/**
 * Gemini Developer API (API key).
 *
 * - @google/genai with `{ apiKey }` → build MML + classifyBuildIntent (generateContent).
 * - @ai-sdk/google with same key → chat tick (generateText + tools).
 *
 * The AI SDK provider is created once and reused; createGoogleGenerativeAI is not free.
 */

import { GoogleGenAI } from "@google/genai";
import { createGoogleGenerativeAI, type GoogleGenerativeAIProvider } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import type { ClawConfig } from "../../config/index.js";
import { GoogleGenAiProviderBase } from "./googleGenAiBase.js";

/** Read API key from config then env (AI SDK also reads GOOGLE_GENERATIVE_AI_API_KEY). */
function resolveApiKey(config: ClawConfig): string {
  const apiKey =
    config.googleApiKey ||
    process.env.GOOGLE_API_KEY?.trim() ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "GOOGLE_API_KEY required when LLM_PROVIDER=google. For Vertex use LLM_PROVIDER=google-vertex with GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION."
    );
  }
  return apiKey;
}

/** AI SDK LanguageModelV3 is structurally compatible with generateText; cast at boundary only. */
function toLanguageModel(provider: GoogleGenerativeAIProvider, modelId: string): LanguageModel {
  return provider.chat(modelId) as unknown as LanguageModel;
}

export class GoogleGenAiApiProvider extends GoogleGenAiProviderBase {
  /** Cached AI SDK provider for chat tick (same apiKey as this.ai). */
  private readonly chatProvider: GoogleGenerativeAIProvider;

  constructor(config: ClawConfig) {
    const apiKey = resolveApiKey(config);
    super(new GoogleGenAI({ apiKey }));
    this.chatProvider = createGoogleGenerativeAI({ apiKey });
  }

  getChatModel(modelId: string): LanguageModel {
    return toLanguageModel(this.chatProvider, modelId);
  }
}
