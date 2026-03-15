/**
 * Claw agent as AI SDK ToolLoopAgent.
 * Single place for model, instructions, tools, stopWhen, prepareCall, prepareStep.
 *
 * @see https://ai-sdk.dev/docs/agents/building-agents
 * @see https://ai-sdk.dev/docs/agents/loop-control
 * @see docs/PLAN-AI-SDK-REFACTOR.md
 */

import {
  ToolLoopAgent,
  stepCountIs,
  InferAgentUIMessage,
  type LanguageModel,
} from "ai";
import type { DoppelClient } from "@doppelfun/sdk";
import type { ClawStore } from "../state/index.js";
import type { ClawConfig } from "../config/index.js";
import {
  buildClawToolSet,
  resolveTickLanguageModel,
  MUST_ACT_BUILD_TOOL_NAMES,
  type RunTickLlmResult,
  type RunTickWithAiSdkOptions,
} from "../llm/toolsAi.js";
import { usageFromAiSdk } from "../llm/usage.js";
import { executeTool, type ExecuteToolResult } from "../tools/index.js";
import { clawLog, clawDebug } from "../log.js";
import { delay } from "../../util/delay.js";

const NO_CHAT_MODEL_ERROR =
  "No chat model: LLM_PROVIDER=google needs GOOGLE_API_KEY; google-vertex needs project/location; or set OPENROUTER_API_KEY for OpenRouter.";
const MODEL_NOT_FOUND_HINT =
  "If using OpenRouter, use an OpenRouter model id. If using google/google-vertex, use a Gemini id from the API/Vertex model list.";
const MIN_THINKING_MS = 700;
const MAX_LLM_STEPS_PER_TICK = 5;

/** Prompt suffix when in must_act_build so the LLM only uses build tools. */
const MUST_ACT_BUILD_SUFFIX =
  "\n\n[Phase: must_act_build — chat is disabled until you run generate_procedural or build_full/build_incremental. Call one of those now; do not call chat.]";

type ClawToolSet = ReturnType<typeof buildClawToolSet>;

/**
 * Create a ToolLoopAgent for Claw: full tool set, dynamic instructions and activeTools via prepareCall/prepareStep.
 * When overrideModel is provided (e.g. from model router), that model is used for this tick instead of config.chatLlmModel.
 */
export function createClawAgent(
  client: DoppelClient,
  store: ClawStore,
  config: ClawConfig,
  systemContent: string,
  onToolResult?: (name: string, args: string, result: ExecuteToolResult) => void,
  overrideModel?: LanguageModel | null
): ToolLoopAgent<RunTickWithAiSdkOptions, ClawToolSet> {
  const model = overrideModel ?? resolveTickLanguageModel(config);
  if (!model) throw new Error(NO_CHAT_MODEL_ERROR);

  const tools = buildClawToolSet(client, store, config, { onToolResult });
  const allToolNames = Object.keys(tools) as (keyof ClawToolSet)[];

  const callOptionsRef: { current: RunTickWithAiSdkOptions | null } = { current: null };

  return new ToolLoopAgent<RunTickWithAiSdkOptions, ClawToolSet>({
    model: model as LanguageModel,
    instructions: systemContent,
    tools,
    stopWhen: stepCountIs(MAX_LLM_STEPS_PER_TICK),
    maxOutputTokens: 1024,
    temperature: 0.3,
    /** Per call: stash options for prepareStep; override instructions when in must_act_build. */
    prepareCall: (opts) => {
      callOptionsRef.current = opts.options ?? null;
      const state = store.getState();
      const instructions =
        state.tickPhase === "must_act_build" ? systemContent + MUST_ACT_BUILD_SUFFIX : systemContent;
      return { ...opts, instructions };
    },
    /** Per step: restrict to build-only tools, or omit chat when we already sent this turn. */
    prepareStep: () => {
      const opts = callOptionsRef.current;
      const state = store.getState();
      if (opts?.allowOnlyTools?.length) return { activeTools: opts.allowOnlyTools as (keyof ClawToolSet)[] };
      if (state.lastTickSentChat) return { activeTools: allToolNames.filter((n) => n !== "chat") };
      return {};
    },
  });
}

/** Type for useChat / UI when consuming the Claw agent. */
export type ClawAgentUIMessage = InferAgentUIMessage<
  ReturnType<typeof createClawAgent>
>;

type ToolCallLike = { toolName?: string; name?: string; args?: unknown; input?: unknown };

function collectToolInvocations(result: { toolCalls?: unknown[]; steps?: Array<{ toolCalls?: unknown[] }> }): Array<{ name: string; args: Record<string, unknown> }> {
  const out: Array<{ name: string; args: Record<string, unknown> }> = [];
  const seen = new Set<string>();
  const add = (c: unknown) => {
    const t = c as ToolCallLike;
    const name = (t.toolName ?? t.name ?? "?").toString();
    if (!name || name === "?") return;
    const key = `${name}:${JSON.stringify(t.args ?? t.input ?? {})}`;
    if (seen.has(key)) return;
    seen.add(key);
    const args = (t.args ?? t.input ?? {}) as Record<string, unknown>;
    out.push({ name, args: args && typeof args === "object" && !Array.isArray(args) ? args : {} });
  };
  for (const c of result.toolCalls ?? []) add(c);
  for (const step of result.steps ?? []) for (const c of step.toolCalls ?? []) add(c);
  return collapseMoveInvocations(out);
}

const MOVEMENT_TOOL_NAMES = ["approach_position", "approach_person", "stop"];

/**
 * When the LLM returns multiple movement tool calls, execute only one. Prefer approach_position, then approach_person, then stop.
 */
function collapseMoveInvocations(
  invocations: Array<{ name: string; args: Record<string, unknown> }>
): Array<{ name: string; args: Record<string, unknown> }> {
  const movementCalls = invocations.filter((i) => MOVEMENT_TOOL_NAMES.includes(i.name));
  if (movementCalls.length <= 1) return invocations;
  const withPosition = movementCalls.find((m) => m.name === "approach_position");
  const withPerson = movementCalls.find((m) => m.name === "approach_person");
  const withStop = movementCalls.find((m) => m.name === "stop");
  const chosen = withPosition ?? withPerson ?? withStop ?? movementCalls[movementCalls.length - 1]!;
  const rest = invocations.filter((i) => !MOVEMENT_TOOL_NAMES.includes(i.name));
  return [...rest, chosen];
}

/**
 * Run one tick using the Claw ToolLoopAgent: create agent, generate, return result.
 * When overrideModel is provided (e.g. from model router), that model is used instead of config.chatLlmModel.
 */
export async function runClawAgentTick(
  client: DoppelClient,
  store: ClawStore,
  config: ClawConfig,
  systemContent: string,
  userContent: string,
  onToolResult?: (name: string, args: string, result: ExecuteToolResult) => void,
  sdkOptions?: RunTickWithAiSdkOptions,
  overrideModel?: LanguageModel | null
): Promise<RunTickLlmResult> {
  const model = overrideModel ?? resolveTickLanguageModel(config);
  if (!model) return { ok: false, error: NO_CHAT_MODEL_ERROR };

  let executedCount = 0;
  const wrappedOnResult = (name: string, args: string, res: ExecuteToolResult) => {
    executedCount++;
    onToolResult?.(name, args, res);
  };
  const agent = createClawAgent(client, store, config, systemContent, wrappedOnResult, model);
  const toolNames = Object.keys(agent.tools);
  const mode =
    sdkOptions?.allowOnlyTools?.length != null
      ? "build-only"
      : (sdkOptions?.omitChat ?? store.getState().lastTickSentChat)
        ? "omitChat"
        : "full";
  clawLog(
    "LLM call",
    overrideModel ? "model=router" : config.chatLlmModel,
    "provider=" + config.llmProvider,
    "tools=" + toolNames.length,
    mode
  );
  clawDebug("tool names:", toolNames.join(", "));

  const t0 = Date.now();
  client.sendThinking(true);
  try {
    const result = await agent.generate({
      prompt: userContent,
      options: sdkOptions ?? {},
    });

    const hadToolCalls =
      (result.toolCalls?.length ?? 0) > 0 ||
      (result.steps?.some((s) => (s.toolCalls?.length ?? 0) > 0) ?? false);
    const usage = usageFromAiSdk(result.usage);
    const ms = Date.now() - t0;
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
    if (hadToolCalls) {
      const fromResult =
        (result.toolCalls ?? []).map((c) => (c as { toolName?: string }).toolName ?? "?");
      const fromSteps = (result.steps ?? []).flatMap((s) =>
        (s.toolCalls ?? []).map((c) => (c as { toolName?: string }).toolName ?? "?")
      );
      const names = [...fromResult, ...fromSteps].filter(Boolean);
      if (names.length) clawLog("LLM requested tools:", names.join(", "));
    }

    // Fallback: Gemini (and some providers) sometimes return tool_calls but the SDK does not run execute().
    // Run tool execution ourselves so move/chat/etc. actually run.
    if (hadToolCalls && executedCount === 0) {
      const invocations = collectToolInvocations(result);
      for (const { name, args } of invocations) {
        if (!name || !Object.prototype.hasOwnProperty.call(agent.tools, name)) continue;
        try {
          const res = await executeTool(client, store, config, { name, args: args ?? {} });
          wrappedOnResult(name, JSON.stringify(args), res);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          clawLog("tool fallback execute", name, msg);
          wrappedOnResult(name, JSON.stringify(args), { ok: false, error: msg });
        }
      }
    }

    return { ok: true, usage, hadToolCalls, replyText };
  } catch (e) {
    let msg = e instanceof Error ? e.message : String(e);
    if (msg === "Not Found" || /404|not found/i.test(msg) || /model.*not found/i.test(msg)) {
      msg = `${msg} (LLM_PROVIDER=${config.llmProvider} CHAT_LLM_MODEL=${config.chatLlmModel}). ${MODEL_NOT_FOUND_HINT}`;
    }
    clawLog("LLM error", msg);
    return { ok: false, error: msg };
  } finally {
    const elapsed = Date.now() - t0;
    if (elapsed < MIN_THINKING_MS) await delay(MIN_THINKING_MS - elapsed);
    client.sendThinking(false);
  }
}
