import type { DoppelClient } from "@doppelfun/sdk";
import type { ClawStore } from "../../state/index.js";
import type { ClawConfig } from "../../config/index.js";
import { usageFromAiSdk } from "../../llm/usage.js";
import type { RunTickLlmResult } from "../../llm/toolsAi.js";
import type { ExecuteToolResult } from "../../tools/index.js";
import { clawLog } from "../../log.js";
import { delay } from "../../../util/delay.js";
import { MIN_THINKING_MS } from "./constants.js";

export type AgentLike = {
  generate(params: { prompt: string; options?: Record<string, unknown> }): Promise<{
    text?: string;
    toolCalls?: unknown[];
    steps?: Array<{ toolCalls?: unknown[] }>;
    usage?: unknown;
  }>;
  tools: Record<string, unknown>;
};

export type CreateAgentFn = (
  client: DoppelClient,
  store: ClawStore,
  config: ClawConfig,
  systemContent: string,
  onToolResult?: (name: string, args: string, result: ExecuteToolResult) => void
) => unknown;

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
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    clawLog("LLM error", label, msg);
    if (stack) clawLog("LLM error stack:", stack);
    return { ok: false, error: msg };
  } finally {
    const elapsed = Date.now() - t0;
    if (elapsed < MIN_THINKING_MS) await delay(MIN_THINKING_MS - elapsed);
    client.sendThinking?.(false);
  }
}
