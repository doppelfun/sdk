/**
 * Gemini code execution (Python sandbox) via @google/genai.
 * Used for build_with_code only; AI SDK Google provider does not expose this tool.
 */
import { GoogleGenAI } from "@google/genai";
import type { ClawConfig } from "../config/index.js";
import type { Usage } from "./usage.js";
import { clawLog } from "../../util/log.js";

export type CodeExecResult =
  | { ok: true; content: string; usage: Usage | null }
  | { ok: false; error: string };

/** Map @google/genai response metadata to our Usage type. */
function usageFromGenai(meta: {
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

/**
 * Create a GoogleGenAI client when config.llmProvider is google or google-vertex.
 *
 * @param config - Claw config (llmProvider, googleApiKey or googleCloudProject/location)
 * @returns GoogleGenAI instance or null if openrouter or credentials missing
 */
export function createGeminiClient(config: ClawConfig): GoogleGenAI | null {
  if (config.llmProvider === "openrouter") return null;
  
  if (config.llmProvider === "google") {
    const apiKey =
      config.googleApiKey ||
      (typeof process !== "undefined" && process.env.GOOGLE_API_KEY?.trim()) ||
      (typeof process !== "undefined" && process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim());
    if (!apiKey) return null;
    return new GoogleGenAI({ apiKey });
  }

  if (config.llmProvider === "google-vertex") {
    const project =
      config.googleCloudProject ||
      (typeof process !== "undefined" && process.env.GOOGLE_CLOUD_PROJECT?.trim());
    const location =
      config.googleCloudLocation ||
      (typeof process !== "undefined" && process.env.GOOGLE_CLOUD_LOCATION?.trim());
    if (!project || !location) return null;
    return new GoogleGenAI({ vertexai: true, project, location });
  }

  return null;
}

/**
 * Run Gemini generateContent with code execution tool (Python sandbox).
 *
 * @param ai - GoogleGenAI client from createGeminiClient
 * @param modelId - Model id (e.g. gemini-2.0-flash-exp)
 * @param system - System instruction (MML rules, coords)
 * @param user - User message (instruction)
 * @param options - maxOutputTokens, temperature
 * @returns CodeExecResult (content = model output or code execution result, usage)
 */
export async function runCodeExecution(
  ai: GoogleGenAI,
  modelId: string,
  system: string,
  user: string,
  options?: { maxOutputTokens?: number; temperature?: number }
): Promise<CodeExecResult> {
  try {
    const response = await ai.models.generateContent({
      model: modelId,
      contents: user,
      config: {
        systemInstruction: system,
        maxOutputTokens: options?.maxOutputTokens ?? 8192,
        temperature: options?.temperature ?? 0.2,
        tools: [{ codeExecution: {} }],
      },
    });
    let content = response.text ?? "";
    const codeOut = (response as { codeExecutionResult?: string }).codeExecutionResult;
    if (!content.trim() && typeof codeOut === "string" && codeOut.trim()) {
      content = codeOut;
    }
    const usage = usageFromGenai(response.usageMetadata);
    return { ok: true, content, usage };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    clawLog("geminiCodeExec: runCodeExecution error", msg);
    if (e instanceof Error && e.stack) clawLog("geminiCodeExec: stack", e.stack);
    if (/1048576|input token count exceeds/i.test(msg)) {
      return {
        ok: false,
        error:
          "Gemini input limit (1M tokens) exceeded. Try build_full instead or a shorter instruction.",
      };
    }
    return { ok: false, error: msg };
  }
}
