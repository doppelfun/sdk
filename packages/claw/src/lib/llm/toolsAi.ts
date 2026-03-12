/**
 * Claw tools exposed as Vercel AI SDK tools.
 *
 * Flow: generateText(model, tools) → model may emit tool calls → each tool's execute() runs
 * executeTool() in-process. stopWhen uses multiple steps so one tick can chain tools
 * (e.g. list_documents then delete_document × N, or delete_all_documents after list).
 *
 * Model backends:
 * - OpenRouter: OpenAI-compatible baseURL + API key (default).
 * - Google: provider.getChatModel() → @ai-sdk/google or @ai-sdk/google-vertex (no OpenRouter).
 */

import { dynamicTool, generateText, stepCountIs, zodSchema, type LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { DoppelClient } from "@doppelfun/sdk";
import { CLAW_TOOL_REGISTRY, getToolSchema } from "../tools/toolsZod.js";
import { executeTool, type ExecuteToolResult } from "../tools/tools.js";
import type { ClawState } from "../state/state.js";
import type { ClawConfig } from "../config/config.js";
import { createLlmProvider } from "./provider.js";
import { usageFromAiSdk, type Usage } from "./usage.js";
import { clawLog, clawDebug } from "../log.js";

/**
 * Wrap one registry entry as an AI SDK tool: Zod → JSON Schema for the model;
 * execute validates again then calls executeTool.
 */
function clawTool(
  name: string,
  description: string,
  schema: (typeof CLAW_TOOL_REGISTRY)[number]["schema"],
  client: DoppelClient,
  state: ClawState,
  config: ClawConfig,
  onResult?: (name: string, args: string, result: ExecuteToolResult) => void
) {
  return dynamicTool({
    description,
    inputSchema: zodSchema(schema),
    execute: async (args: unknown) => {
      const record =
        args && typeof args === "object" && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : {};
      const zodSchemaForTool = getToolSchema(name);
      let payload: Record<string, unknown> = record;
      if (zodSchemaForTool) {
        const parsed = zodSchemaForTool.safeParse(record);
        if (!parsed.success) {
          const msg = parsed.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ");
          throw new Error(`Invalid tool arguments: ${msg}`);
        }
        payload = parsed.data as Record<string, unknown>;
      }
      const argsJson = JSON.stringify(payload);
      let result: ExecuteToolResult;
      try {
        result = await executeTool(client, state, config, { name, args: payload });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        result = { ok: false, error: msg };
        clawLog("tool execute threw", name, msg);
      }
      onResult?.(name, argsJson, result);
      if (!result.ok) throw new Error(result.error);
      return result.summary ?? "ok";
    },
  });
}

/** Tool names allowed when must_act_build uses LLM (no chat until build runs). */
export const MUST_ACT_BUILD_TOOL_NAMES = [
  "generate_procedural",
  "build_full",
  "build_incremental",
  "list_catalog",
  "list_documents",
  "join_block",
] as const;

/**
 * Build AI SDK tool map from Zod registry.
 * - omitChat: exclude chat tool (e.g. after a chat was already sent this turn).
 * - allowOnlyTools: restrict to a subset (build-only phase).
 */
export function buildClawToolSet(
  client: DoppelClient,
  state: ClawState,
  config: ClawConfig,
  options: {
    omitChat?: boolean;
    allowOnlyTools?: readonly string[];
    onToolResult?: (name: string, args: string, result: ExecuteToolResult) => void;
  }
): Record<string, ReturnType<typeof dynamicTool>> {
  let entries = options.omitChat
    ? CLAW_TOOL_REGISTRY.filter((t) => t.name !== "chat")
    : CLAW_TOOL_REGISTRY;
  if (options.allowOnlyTools && options.allowOnlyTools.length > 0) {
    const allow = new Set(options.allowOnlyTools);
    entries = entries.filter((t) => allow.has(t.name));
  }
  const tools: Record<string, ReturnType<typeof dynamicTool>> = {};
  for (const t of entries) {
    tools[t.name] = clawTool(
      t.name,
      t.description,
      t.schema,
      client,
      state,
      config,
      options.onToolResult
    );
  }
  return tools;
}

/** OpenRouter via OpenAI-compatible API (shared baseURL). */
export function createOpenRouterModel(apiKey: string, modelId: string): LanguageModel {
  const openrouter = createOpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
    headers: { "HTTP-Referer": "https://github.com/doppel-sdk" },
  });
  return openrouter.chat(modelId);
}

export type RunTickLlmResult =
  | { ok: true; usage: Usage | null; hadToolCalls: boolean; replyText?: string | null }
  | { ok: false; error: string };

/** Minimum time (ms) thinking stays true so UIs can show indicator before flash disappears. */
const MIN_THINKING_MS = 700;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type RunTickWithAiSdkOptions = {
  omitChat?: boolean;
  allowOnlyTools?: readonly string[];
};

const NO_CHAT_MODEL_ERROR =
  "No chat model: LLM_PROVIDER=google needs GOOGLE_API_KEY; google-vertex needs project/location; or set OPENROUTER_API_KEY for OpenRouter.";

/**
 * Max generateText steps per tick. Must be >1 so the model can chain tools
 * (e.g. list_documents then delete_document, or delete_all after one reasoning step).
 * Too high increases token cost if the model loops; 12 is enough for list + ~10 deletes.
 */
const MAX_LLM_STEPS_PER_TICK = 12;

/**
 * Resolve LanguageModel for one tick: provider first, then OpenRouter fallback if key present.
 */
function resolveTickLanguageModel(config: ClawConfig): LanguageModel | null {
  const provider = createLlmProvider(config);
  const fromProvider = provider.getChatModel(config.chatLlmModel);
  if (fromProvider) return fromProvider;
  if (config.openRouterApiKey) {
    return createOpenRouterModel(config.openRouterApiKey, config.chatLlmModel);
  }
  return null;
}

/**
 * One tick: generateText with tools; may run multiple steps until stopWhen (see MAX_LLM_STEPS_PER_TICK).
 * Each tool execute() is executeTool() in-process (engine/hub side effects).
 */
export async function runTickWithAiSdk(
  client: DoppelClient,
  state: ClawState,
  config: ClawConfig,
  systemContent: string,
  userContent: string,
  onToolResult?: (name: string, args: string, result: ExecuteToolResult) => void,
  sdkOptions?: RunTickWithAiSdkOptions
): Promise<RunTickLlmResult> {
  const model = resolveTickLanguageModel(config);
  if (!model) return { ok: false, error: NO_CHAT_MODEL_ERROR };

  const omitChat = sdkOptions?.omitChat ?? state.lastTickSentChat;
  const tools = buildClawToolSet(client, state, config, {
    omitChat,
    allowOnlyTools: sdkOptions?.allowOnlyTools,
    onToolResult,
  });

  const toolNames = Object.keys(tools);
  const mode =
    sdkOptions?.allowOnlyTools?.length != null
      ? "build-only"
      : omitChat
        ? "omitChat"
        : "full";
  clawLog(
    "LLM call",
    config.chatLlmModel,
    "provider=" + config.llmProvider,
    "tools=" + toolNames.length,
    mode
  );
  clawDebug("tool names:", toolNames.join(", "));

  const t0 = Date.now();
  client.sendThinking(true);
  try {
    const result = await generateText({
      model,
      system: systemContent,
      prompt: userContent,
      tools,
      toolChoice: "auto",
      maxOutputTokens: 1024,
      temperature: 0.3,
      stopWhen: stepCountIs(MAX_LLM_STEPS_PER_TICK),
    });

    const hadToolCalls =
      (result.toolCalls?.length ?? 0) > 0 ||
      (result.steps?.some((s) => (s.toolCalls?.length ?? 0) > 0) ?? false);
    const usage = usageFromAiSdk(result.usage);
    const ms = Date.now() - t0;
    // Optional text when model answered without tools (Gemini often does this for DMs)
    const replyText =
      typeof result.text === "string" && result.text.trim()
        ? result.text.trim().slice(0, 500)
        : null;
    clawLog(
      "LLM done",
      ms + "ms",
      usage
        ? `tokens in/out/total=${usage.prompt_tokens}/${usage.completion_tokens}/${usage.total_tokens}`
        : "no usage",
      hadToolCalls ? "toolCalls=yes" : "toolCalls=no"
    );
    if (hadToolCalls && result.toolCalls?.length) {
      clawDebug(
        "toolCalls:",
        result.toolCalls.map((c) => (c as { toolName?: string }).toolName ?? "?").join(", ")
      );
    }
    return { ok: true, usage, hadToolCalls, replyText };
  } catch (e) {
    let msg = e instanceof Error ? e.message : String(e);
    // HTTP 404 from API often surfaces as "Not Found" — add context so wrong model/provider combo is obvious.
    const hint =
      msg === "Not Found" ||
      /404|not found/i.test(msg) ||
      /model.*not found/i.test(msg);
    if (hint) {
      msg = `${msg} (LLM_PROVIDER=${config.llmProvider} CHAT_LLM_MODEL=${config.chatLlmModel}). ` +
        "If using OpenRouter, use an OpenRouter model id. If using google/google-vertex, use a Gemini id from the API/Vertex model list.";
    }
    clawLog("LLM error", msg);
    return { ok: false, error: msg };
  } finally {
    const elapsed = Date.now() - t0;
    if (elapsed < MIN_THINKING_MS) await delay(MIN_THINKING_MS - elapsed);
    client.sendThinking(false);
  }
}
