import type { DoppelClient } from "@doppelfun/sdk";
import { clawLog } from "../log.js";
import type { ClawConfig } from "../config/index.js";
import type { ClawStore } from "../state/index.js";
import type { ToolInvocation, ExecuteToolResult, ToolContext } from "./types.js";
import { TOOL_HANDLERS } from "./handlers/index.js";

export type { ToolInvocation, ExecuteToolResult } from "./types.js";

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
