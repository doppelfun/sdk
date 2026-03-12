/**
 * OpenRouter via OpenAI-compatible API (AI SDK only — no raw fetch).
 *
 * - Chat tick: cached client .chat(modelId) + generateText + tools.
 * - Build MML: same client + generateText (no tools) — same stack as chat.
 * - Intent: generateObject with same chat model.
 */

import type { LanguageModel } from "ai";
import type { ClawConfig } from "../../config/config.js";
import type { LlmProvider, CompletionResult, BuildIntentResult } from "../provider.js";
import type { Usage } from "../usage.js";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, generateObject } from "ai";
import { z } from "zod/v4";
import { usageFromAiSdk } from "../usage.js";

const intentSchema = z.object({
  proceduralKind: z.enum(["city", "pyramid"]).nullable(),
  requiresBuildAction: z.boolean(),
});

const INTENT_PROMPT = `Classify for a 3D block agent (generate_procedural city/pyramid, build_full, build_incremental).
- proceduralKind city/pyramid/null; requiresBuildAction if user asks to build/generate/create.
If unsure: requiresBuildAction false, proceduralKind null.

Message:`;

export class OpenRouterProvider implements LlmProvider {
  readonly kind = "openrouter" as const;

  private readonly openrouter: ReturnType<typeof createOpenAI>;

  constructor(private readonly config: ClawConfig) {
    this.openrouter = createOpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: config.openRouterApiKey,
      headers: { "HTTP-Referer": "https://github.com/doppel-sdk" },
    });
  }

  usageCostUsdBeforeMarkup(_usage: Usage, _modelId: string): number | null {
    return null;
  }

  getChatModel(modelId: string): LanguageModel {
    return this.openrouter.chat(modelId);
  }

  async complete(options: {
    model: string;
    system: string;
    user: string;
    maxOutputTokens?: number;
    temperature?: number;
  }): Promise<CompletionResult> {
    try {
      const result = await generateText({
        model: this.openrouter.chat(options.model),
        system: options.system,
        prompt: options.user,
        maxOutputTokens: options.maxOutputTokens ?? 8192,
        temperature: options.temperature ?? 0.2,
      });
      return {
        ok: true,
        content: result.text,
        usage: usageFromAiSdk(result.usage),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  }

  async classifyBuildIntent(message: string, modelId: string): Promise<BuildIntentResult> {
    const text = message.trim();
    if (!text) return { proceduralKind: null, requiresBuildAction: false };
    const model = this.getChatModel(modelId);
    const { object } = await generateObject({
      model,
      schema: intentSchema,
      prompt: `${INTENT_PROMPT}\n"""${text.slice(0, 500)}"""`,
      maxOutputTokens: 256,
      temperature: 0,
    });
    return {
      proceduralKind: object.proceduralKind ?? null,
      requiresBuildAction: object.requiresBuildAction === true,
    };
  }
}
