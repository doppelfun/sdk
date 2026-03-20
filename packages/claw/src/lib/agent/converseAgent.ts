/**
 * Converse agent: chat-only LLM for when the behaviour tree has already decided we're in conversation.
 *
 * Decision layer (BT) chooses who to talk to and when; this module only generates the next message.
 * Used by RunConverseAgent when InConversation (autonomous branch). Obedient agent is unchanged.
 */
import { ToolLoopAgent, stepCountIs, hasToolCall } from "ai";
import type { DoppelClient } from "@doppelfun/sdk";
import type { ClawStore } from "../state/index.js";
import type { ClawConfig } from "../config/index.js";
import {
  buildClawToolSet,
  resolveTickLanguageModel,
} from "../llm/toolsAi.js";
import type { ExecuteToolResult } from "../../tools/index.js";
import { NO_CHAT_MODEL_ERROR } from "./shared/constants.js";
import { runAgentTick, type AgentLike } from "./shared/runAgentTick.js";
import type { RunTickLlmResult } from "../llm/toolsAi.js";

const CONVERSE_TOOL_NAMES = ["chat"] as const;

const CONVERSE_INSTRUCTIONS = `
[CONVERSE MODE] You are in an ongoing conversation with another person in the world. Reply naturally with one message. Use only the chat tool with the appropriate targetSessionId. Keep your reply brief and in character.`;

/**
 * Create the Converse agent (chat-only). Used when InConversation and BT runs RunConverseAgent.
 *
 * @param client - Engine client
 * @param store - Claw store
 * @param config - Claw config
 * @param systemContent - Base system prompt
 * @param onToolResult - Optional tool result callback
 * @returns AgentLike for runAgentTick
 */
export function createConverseAgent(
  client: DoppelClient,
  store: ClawStore,
  config: ClawConfig,
  systemContent: string,
  onToolResult?: (name: string, args: string, result: ExecuteToolResult) => void
): AgentLike {
  const model = resolveTickLanguageModel(config);
  if (!model) throw new Error(NO_CHAT_MODEL_ERROR);

  const tools = buildClawToolSet(client, store, config, {
    allowOnlyTools: [...CONVERSE_TOOL_NAMES],
    onToolResult,
  });

  return new ToolLoopAgent({
    model,
    instructions: systemContent + CONVERSE_INSTRUCTIONS,
    tools,
    stopWhen: [stepCountIs(4), hasToolCall("chat")],
    maxOutputTokens: 256,
    temperature: 0.3,
  }) as unknown as AgentLike;
}

/**
 * Run one Converse agent tick (chat-only).
 *
 * @param client - Engine client
 * @param store - Claw store
 * @param config - Claw config
 * @param systemContent - Full system prompt
 * @param userContent - Current user message
 * @param onToolResult - Optional callback
 * @returns RunTickLlmResult
 */
export async function runConverseAgentTick(
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
    createConverseAgent,
    "converse",
    onToolResult
  );
}
