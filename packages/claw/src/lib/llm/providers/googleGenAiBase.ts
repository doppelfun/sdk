/**
 * Shared Google Gen AI (@google/genai) logic for build MML + wake intent.
 *
 * Two transport paths exist for Gemini:
 * - **Chat tick:** Vercel AI SDK needs a LanguageModel — @ai-sdk/google (API key) or
 *   @ai-sdk/google-vertex (ADC). Implemented in GoogleGenAiApiProvider / GoogleGenAiVertexProvider.
 * - **Build / intent:** Single-shot generateContent via @google/genai GoogleGenAI — same call shape
 *   for API key and Vertex; only constructor options differ. This base holds one GoogleGenAI instance
 *   and implements complete() + classifyBuildIntent() once.
 *
 * @see https://github.com/googleapis/js-genai
 * @see https://ai.google.dev/gemini-api/docs/models
 */

import type { GoogleGenAI } from "@google/genai";
import type { LanguageModel } from "ai";
import type { LlmProvider, CompletionResult, BuildIntentResult } from "../provider.js";
import type { Usage } from "../usage.js";
import { geminiUsageCostUsd } from "../googleUsageCost.js";

// --- Usage -----------------------------------------------------------------

/** Map @google/genai usageMetadata to hub credit shape (same as OpenRouter Usage). */
export function usageFromGoogle(meta: {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
} | undefined): Usage | null {
  if (!meta || typeof meta.totalTokenCount !== "number") return null;
  return {
    prompt_tokens: meta.promptTokenCount ?? 0,
    completion_tokens: meta.candidatesTokenCount ?? 0,
    total_tokens: meta.totalTokenCount,
  };
}

// --- Intent (wake / must_act_build) ----------------------------------------

const INTENT_SYSTEM = `You output only a single JSON object, no markdown. Keys: proceduralKind (string "city", "pyramid", or null), requiresBuildAction (boolean).
Classify user message for a block-world agent. requiresBuildAction true only if they ask to build/generate/create scene content.`;

const INTENT_USER_SUFFIX = `Reply with JSON only: {"proceduralKind":"city"|"pyramid"|null,"requiresBuildAction":true|false}`;

/** Parse first JSON object from model text; safe fallback on miss/parse error. */
function parseBuildIntentJson(raw: string): BuildIntentResult {
  const jsonMatch = raw.trim().match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { proceduralKind: null, requiresBuildAction: false };
  try {
    const o = JSON.parse(jsonMatch[0]!) as {
      proceduralKind?: string | null;
      requiresBuildAction?: boolean;
    };
    const kind = o.proceduralKind;
    const proceduralKind =
      kind === "city" || kind === "pyramid" ? kind : null;
    return {
      proceduralKind,
      requiresBuildAction: o.requiresBuildAction === true,
    };
  } catch {
    return { proceduralKind: null, requiresBuildAction: false };
  }
}

// --- Base class ------------------------------------------------------------

/**
 * Base for Google-backed LlmProvider: build completion + intent both use @google/genai only.
 * Subclasses construct GoogleGenAI (apiKey vs vertexai) and implement getChatModel for the tick.
 */
export abstract class GoogleGenAiProviderBase implements LlmProvider {
  readonly kind = "google" as const;

  constructor(protected readonly ai: GoogleGenAI) {}

  usageCostUsdBeforeMarkup(usage: Usage, modelId: string): number | null {
    if (usage.total_tokens <= 0) return null;
    return geminiUsageCostUsd(usage, modelId);
  }

  abstract getChatModel(modelId: string): LanguageModel;

  async complete(options: {
    model: string;
    system: string;
    user: string;
    maxOutputTokens?: number;
    temperature?: number;
  }): Promise<CompletionResult> {
    try {
      const response = await this.ai.models.generateContent({
        model: options.model,
        contents: options.user,
        config: {
          systemInstruction: options.system,
          maxOutputTokens: options.maxOutputTokens ?? 8192,
          temperature: options.temperature ?? 0.2,
        },
      });
      const content = response.text ?? "";
      const usage = usageFromGoogle(response.usageMetadata);
      return { ok: true, content, usage };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  }

  async classifyBuildIntent(message: string, modelId: string): Promise<BuildIntentResult> {
    const text = message.trim();
    if (!text) return { proceduralKind: null, requiresBuildAction: false };
    const response = await this.ai.models.generateContent({
      model: modelId,
      contents: `Message:\n"""${text.slice(0, 500)}"""\n\n${INTENT_USER_SUFFIX}`,
      config: {
        systemInstruction: INTENT_SYSTEM,
        maxOutputTokens: 128,
        temperature: 0,
      },
    });
    return parseBuildIntentJson(response.text ?? "");
  }
}
