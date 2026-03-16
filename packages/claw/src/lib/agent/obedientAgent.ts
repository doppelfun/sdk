/**
 * Obedient agent: owner or cron wake. Chat, move, or (stubbed) build.
 */
import { ToolLoopAgent, stepCountIs, hasToolCall } from "ai";
import type { DoppelClient } from "@doppelfun/sdk";
import type { ClawStore } from "../state/index.js";
import type { ClawConfig } from "../config/index.js";
import {
  buildClawToolSet,
  resolveTickLanguageModel,
  type RunTickLlmResult,
} from "../llm/toolsAi.js";
import type { ExecuteToolResult } from "../tools/index.js";
import { createRunBuildTool } from "./subagents/build/index.js";
import { NO_CHAT_MODEL_ERROR } from "./shared/constants.js";
import { runAgentTick, type AgentLike } from "./shared/runAgentTick.js";

const OBEDIENT_TOOL_NAMES = [
  "chat",
  "get_occupants",
  "approach_position",
  "approach_person",
  "stop",
  "run_build",
] as const;

const OBEDIENT_INSTRUCTIONS = `
[OBEDIENT MODE] Do exactly one of:
1) Conversation: reply once with the chat tool (targetSessionId = owner / last DM peer), then stop.
2) Move: use get_occupants if needed, then approach_position or approach_person; reply with chat saying where you're moving. Then stop.
3) Build: call run_build with the owner's request. The build subagent will ask premade or custom and guide them. Then stop.
Only the owner can ask you to move or build. If someone else asks, reply "Sorry, I only perform tasks for my owner." Do one action then stop.`;

/**
 * Create the Obedient agent (ToolLoopAgent): chat, get_occupants, approach_*, stop, run_build.
 * Used when HasOwnerWake (owner DM, cron task, or DM to reply).
 *
 * @param client - Engine client for sendChat, sendThinking, etc.
 * @param store - Claw store
 * @param config - Claw config (owner, model, etc.)
 * @param systemContent - Base system prompt (soul + skills from buildSystemContent)
 * @param onToolResult - Optional callback when a tool finishes
 * @returns AgentLike (generate + tools) for runAgentTick
 */
export function createObedientAgent(
  client: DoppelClient,
  store: ClawStore,
  config: ClawConfig,
  systemContent: string,
  onToolResult?: (name: string, args: string, result: ExecuteToolResult) => void
): AgentLike {
  const model = resolveTickLanguageModel(config);
  if (!model) throw new Error(NO_CHAT_MODEL_ERROR);

  const baseTools = buildClawToolSet(client, store, config, {
    allowOnlyTools: OBEDIENT_TOOL_NAMES.filter((n) => n !== "run_build"),
    onToolResult,
  });
  const tools = {
    ...baseTools,
    run_build: createRunBuildTool(client, store, config, onToolResult),
  };

  return new ToolLoopAgent({
    model,
    instructions: systemContent + OBEDIENT_INSTRUCTIONS,
    tools,
    stopWhen: [
      stepCountIs(5),
      hasToolCall("chat"),
      hasToolCall("approach_position"),
      hasToolCall("approach_person"),
      hasToolCall("run_build"),
    ],
    maxOutputTokens: 1024,
    temperature: 0.3,
  }) as unknown as AgentLike;
}

/**
 * Run one Obedient agent tick: build agent, generate with userContent, return usage and reply.
 *
 * @param client - Engine client
 * @param store - Claw store
 * @param config - Claw config
 * @param systemContent - Full system prompt (base + OBEDIENT_INSTRUCTIONS)
 * @param userContent - Current user message (from buildUserMessage)
 * @param onToolResult - Optional tool result callback
 * @returns RunTickLlmResult (ok, usage, hadToolCalls, replyText)
 */
export async function runObedientAgentTick(
  client: DoppelClient,
  store: ClawStore,
  config: ClawConfig,
  systemContent: string,
  userContent: string,
  onToolResult?: (name: string, args: string, result: ExecuteToolResult) => void
): Promise<RunTickLlmResult> {
  return runAgentTick(
    client,
    store,
    config,
    systemContent,
    userContent,
    createObedientAgent,
    "obedient",
    onToolResult
  );
}
