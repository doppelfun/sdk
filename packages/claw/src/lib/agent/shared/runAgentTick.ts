/**
 * Shared agent tick: run one LLM generate with the given agent factory, log, return usage and reply.
 */
import type { DoppelClient } from "@doppelfun/sdk";
import type { ClawStore } from "../../state/index.js";
import type { ClawConfig } from "../../config/index.js";
import { usageFromAiSdk } from "../../llm/usage.js";
import type { RunTickLlmResult } from "../../llm/toolsAi.js";
import type { ExecuteToolResult } from "../../../tools/index.js";
import { clawLog } from "../../../util/log.js";
import { logClawAiSdkApiError } from "../../../util/aiSdkErrorLog.js";
import { delay } from "../../../util/delay.js";
import { MIN_THINKING_MS } from "./constants.js";

/** Minimal agent interface: generate(prompt) and tools. Implemented by ToolLoopAgent. */
export type AgentLike = {
  generate(params: { prompt: string; options?: Record<string, unknown> }): Promise<{
    text?: string;
    toolCalls?: unknown[];
    steps?: Array<{ toolCalls?: unknown[] }>;
    usage?: unknown;
  }>;
  tools: Record<string, unknown>;
};

/** Factory that creates an AgentLike given client, store, config, systemContent, optional onToolResult. */
export type CreateAgentFn = (
  client: DoppelClient,
  store: ClawStore,
  config: ClawConfig,
  systemContent: string,
  onToolResult?: (name: string, args: string, result: ExecuteToolResult) => void
) => unknown;

/**
 * Run one agent tick: create agent via createAgent, call generate(userContent), map usage and reply.
 * Sends thinking true/false around the call; enforces MIN_THINKING_MS in finally.
 *
 * @param client - Engine client (for sendThinking)
 * @param store - Claw store
 * @param config - Claw config
 * @param systemContent - Full system prompt
 * @param userContent - User message for this tick
 * @param createAgent - Factory (e.g. createObedientAgent)
 * @param label - Log label (e.g. "obedient")
 * @param onToolResult - Optional tool result callback
 * @returns RunTickLlmResult (ok, usage?, hadToolCalls, replyText?) or (ok: false, error)
 */
export async function runAgentTick(
  client: DoppelClient,
  store: ClawStore,
  config: ClawConfig,
  systemContent: string,
  userContent: string,
  createAgent: CreateAgentFn,
  label: string,
  onToolResult?: (name: string, args: string, result: ExecuteToolResult) => void
): Promise<RunTickLlmResult> {
  const agent = createAgent(client, store, config, systemContent, onToolResult) as AgentLike;
  clawLog("LLM call", label, config.chatLlmModel);

  const t0 = Date.now();
  client.sendThinking?.(true);
  try {
    const result = await agent.generate({ prompt: userContent, options: {} });
    const hadToolCalls =
      (result.toolCalls?.length ?? 0) > 0 ||
      (result.steps?.some((s) => (s.toolCalls?.length ?? 0) > 0) ?? false);
    const usage = usageFromAiSdk(
      result.usage as { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined
    );
    const replyText =
      typeof result.text === "string" && result.text.trim() ? result.text.trim().slice(0, 500) : null;
    const toolNames: string[] = [];
    for (const tc of result.toolCalls ?? []) {
      const name = (tc as { name?: string }).name;
      if (typeof name === "string") toolNames.push(name);
    }
    for (const step of result.steps ?? []) {
      for (const tc of step.toolCalls ?? []) {
        const name = (tc as { name?: string }).name;
        if (typeof name === "string" && !toolNames.includes(name)) toolNames.push(name);
      }
    }
    const doneArgs: unknown[] = ["LLM done", label, Date.now() - t0 + "ms", "toolCalls=" + hadToolCalls, replyText ? `replyText=${replyText.slice(0, 80)}${replyText.length > 80 ? "…" : ""}` : "replyText=null"];
    if (toolNames.length > 0) doneArgs.push("tools=" + toolNames.join(","));
    clawLog(...doneArgs);
    if (replyText) clawLog("LLM response:", replyText);
    else if (toolNames.length > 0) clawLog("LLM response: (tool use only)", "tools=" + toolNames.join(", "));
    return { ok: true, usage, hadToolCalls, replyText };
  } catch (e) {
    logClawAiSdkApiError(label, "tick", e);
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  } finally {
    const elapsed = Date.now() - t0;
    if (elapsed < MIN_THINKING_MS) await delay(MIN_THINKING_MS - elapsed);
    client.sendThinking?.(false);
  }
}
