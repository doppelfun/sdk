/**
 * Obedient agent: owner or cron wake. Chat, move, or build (direct tools).
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
import type { ExecuteToolResult } from "../../tools/index.js";
import { NO_CHAT_MODEL_ERROR } from "./shared/constants.js";
import { runAgentTick, type AgentLike } from "./shared/runAgentTick.js";

const OBEDIENT_TOOL_NAMES = [
  "chat",
  "start_conversation",
  "emote",
  "get_occupants",
  "approach_position",
  "approach_person",
  "follow",
  "stop",
  "list_catalog",
  "place_catalog_model",
  "list_documents",
  "get_document_content",
  "list_recipes",
  "run_recipe",
  "build_full",
  // "build_incremental", // disabled: always add new document so user can delete/edit latest only
  "build_with_code",
  "delete_document",
  "delete_all_documents",
] as const;

const OBEDIENT_INSTRUCTIONS = `
[OBEDIENT MODE] Do exactly one of:
1) Conversation: If the user asks you to talk to, message, or start a conversation with another person (e.g. "go talk to Alice", "say hi to Bob"), call get_occupants, find that person's clientId by username, then use start_conversation with that clientId (and optional openingMessage). Do not reply to the user — go talk to the person they named. Otherwise reply once with the chat tool (targetSessionId = owner / last DM peer). Then stop.
2) Move: use get_occupants if needed, then approach_position, approach_person, or follow (to follow someone); reply with chat saying where you're moving. Then stop.
3) Build: use list_recipes to see options. Use run_recipe with kind city/pyramid/grass/trees and optional params. For custom scenes use build_full or build_with_code for complex scenes with an instruction (always creates a new document). To place a catalog model at coordinates use place_catalog_model with catalogId (from list_catalog), x, y, z; optionally documentId to append to an existing document. Use list_catalog, list_documents, get_document_content, delete_document, delete_all_documents as needed. Then stop.
Only the owner can ask you to move or build. If someone else asks, reply "Sorry, I only perform tasks for my owner." Do one action then stop.`;

/**
 * Create the Obedient agent (ToolLoopAgent): chat, move, build/recipe tools.
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

  const tools = buildClawToolSet(client, store, config, {
    allowOnlyTools: [...OBEDIENT_TOOL_NAMES],
    onToolResult,
  });

  return new ToolLoopAgent({
    model,
    instructions: systemContent + OBEDIENT_INSTRUCTIONS,
    tools,
    stopWhen: [
      stepCountIs(8),
      hasToolCall("chat"),
      hasToolCall("start_conversation"),
      // Do not stop after get_occupants — it is often a precursor to approach_* or other actions (e.g. scheduled "go to X and emote").
      hasToolCall("approach_position"),
      hasToolCall("approach_person"),
      hasToolCall("follow"),
      hasToolCall("stop"),
      hasToolCall("list_recipes"),
      hasToolCall("run_recipe"),
      hasToolCall("place_catalog_model"),
      hasToolCall("build_full"),
      // hasToolCall("build_incremental"), // disabled
      hasToolCall("build_with_code"),
      hasToolCall("delete_document"),
      hasToolCall("delete_all_documents"),
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
