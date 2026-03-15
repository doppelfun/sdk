/**
 * OpenRouter via @openrouter/ai-sdk-provider.
 *
 * - Chat tick: getOpenRouterLanguageModel(config, modelId) + generateText + tools.
 * - Build MML: same model + generateText (no tools).
 * - Intent: generateObject with same chat model.
 * All model access goes through getOpenRouterLanguageModel.
 */

import type { LanguageModel } from "ai";
import type { ClawConfig } from "../../config/index.js";
import type { LlmProvider, CompletionResult, BuildIntentResult } from "../provider.js";
import type { Usage } from "../usage.js";
import { generateText, generateObject } from "ai";
import { z } from "zod/v4";
import { usageFromAiSdk } from "../usage.js";
import { getOpenRouterLanguageModel } from "./openrouter.js";

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

  constructor(private readonly config: ClawConfig) {}

  usageCostUsdBeforeMarkup(_usage: Usage, _modelId: string): number | null {
    return null;
  }

  getChatModel(modelId: string): LanguageModel | null {
    return getOpenRouterLanguageModel(this.config, modelId);
  }

  /** Single generateText call (no tools); used for build MML and similar. */
  async complete(options: {
    model: string;
    system: string;
    user: string;
    maxOutputTokens?: number;
    temperature?: number;
  }): Promise<CompletionResult> {
    const model = getOpenRouterLanguageModel(this.config, options.model);
    if (!model) return { ok: false, error: "OpenRouter API key not set" };
    try {
      const result = await generateText({
        model,
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

  async completeWithCodeExecution(): Promise<CompletionResult> {
    return {
      ok: false,
      error:
        "build_with_code requires LLM_PROVIDER=google or google-vertex (Gemini code execution sandbox).",
    };
  }

  /** Classify user message into procedural kind (city/pyramid) and whether build action is required. */
  async classifyBuildIntent(message: string, modelId: string): Promise<BuildIntentResult> {
    const text = message.trim();
    if (!text) return { proceduralKind: null, requiresBuildAction: false };
    const model = getOpenRouterLanguageModel(this.config, modelId);
    if (!model) return { proceduralKind: null, requiresBuildAction: false };
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
