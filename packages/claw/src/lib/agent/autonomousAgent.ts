/**
 * Autonomous agent: non-owner wake. Seek, move, chat. Build stubbed.
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
import { createRunBuildStubTool } from "./subagents/build/index.js";
import { NO_CHAT_MODEL_ERROR } from "./shared/constants.js";
import { runAgentTick, type AgentLike } from "./shared/runAgentTick.js";

const AUTONOMOUS_TOOL_NAMES = [
  "chat",
  "get_occupants",
  "approach_position",
  "approach_person",
  "stop",
] as const;

const AUTONOMOUS_INSTRUCTIONS = `
[AUTONOMOUS MODE] You may seek out others (get_occupants, then approach_person), then chat. Use chat with targetSessionId for DMs. One message per turn when talking to another agent. Stop after chat or when done. Building is not available.`;

export function createAutonomousAgent(
  client: DoppelClient,
  store: ClawStore,
  config: ClawConfig,
  systemContent: string,
  onToolResult?: (name: string, args: string, result: ExecuteToolResult) => void
): AgentLike {
  const model = resolveTickLanguageModel(config);
  if (!model) throw new Error(NO_CHAT_MODEL_ERROR);

  const baseTools = buildClawToolSet(client, store, config, {
    allowOnlyTools: [...AUTONOMOUS_TOOL_NAMES],
    onToolResult,
  });
  const tools = {
    ...baseTools,
    run_build: createRunBuildStubTool(),
  };

  return new ToolLoopAgent({
    model,
    instructions: systemContent + AUTONOMOUS_INSTRUCTIONS,
    tools,
    stopWhen: [stepCountIs(8), hasToolCall("chat"), hasToolCall("run_build")],
    maxOutputTokens: 1024,
    temperature: 0.3,
  }) as unknown as AgentLike;
}

export async function runAutonomousAgentTick(
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
    createAutonomousAgent,
    "autonomous",
    onToolResult
  );
}
