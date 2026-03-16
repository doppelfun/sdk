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
