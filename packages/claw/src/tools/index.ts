/**
 * Claw tools: executeTool dispatches to handlers (chat, move, get_occupants, build/recipe). Used by Obedient/Autonomous agents.
 */
import type { DoppelClient } from "@doppelfun/sdk";
import { clawLog } from "../util/log.js";
import type { ClawConfig } from "../lib/config/index.js";
import type { ClawStore } from "../lib/state/index.js";
import type { ToolInvocation, ExecuteToolResult, ToolContext } from "./types.js";
import { TOOL_HANDLERS } from "./handlers/index.js";

export type { ToolInvocation, ExecuteToolResult } from "./types.js";

/**
 * Execute one tool by name. Looks up handler from TOOL_HANDLERS and runs it with client, store, config, args.
 *
 * @param client - Engine client
 * @param store - Claw store
 * @param config - Claw config
 * @param tool - { name, args }
 * @returns ExecuteToolResult (ok + summary, or ok: false + error)
 */
export async function executeTool(
  client: DoppelClient,
  store: ClawStore,
  config: ClawConfig,
  tool: ToolInvocation
): Promise<ExecuteToolResult> {
  const args = tool.args && typeof tool.args === "object" && !Array.isArray(tool.args) ? tool.args : {};
  clawLog("tool", tool.name);
  const ctx: ToolContext = { client, store, config, args, logAction: () => {} };
  const handler = TOOL_HANDLERS[tool.name];
  if (handler) return handler(ctx);
  return { ok: false, error: `Unknown tool: ${tool.name}` };
}
