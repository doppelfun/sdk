/**
 * Tool execution for Claw. Schemas in toolsZod.ts; AI SDK calls via toolsAi → executeTool.
 * Handlers live in handlers/; shared helpers in shared/.
 */

import type { DoppelClient } from "@doppelfun/sdk";
import { clawLog, clawDebug } from "../log.js";
import type { ClawConfig } from "../config/index.js";
import type { ClawStore } from "../state/index.js";
import type { ToolInvocation, ExecuteToolResult, ToolContext } from "./types.js";
import { TOOL_HANDLERS } from "./handlers/index.js";
import { isDocumentIdUuid } from "./shared/documents.js";

export type { ToolInvocation, ExecuteToolResult } from "./types.js";
export type { CatalogEntry } from "./shared/catalog.js";
export { isDocumentIdUuid } from "./shared/documents.js";

/**
 * Execute one tool by name with structured args. Updates state via store (occupants, chat, documents, etc.).
 */
export async function executeTool(
  client: DoppelClient,
  store: ClawStore,
  config: ClawConfig,
  tool: ToolInvocation
): Promise<ExecuteToolResult> {
  const args =
    tool.args && typeof tool.args === "object" && !Array.isArray(tool.args) ? tool.args : {};
  const argKeys = Object.keys(args);
  clawLog("tool", tool.name, argKeys.length ? "args=" + argKeys.join(",") : "args=(none)");
  clawDebug("tool args payload:", JSON.stringify(args).slice(0, 500));

  const logAction = (msg: string) => clawLog("agent", msg);
  const ctx: ToolContext = { client, store, config, args, logAction };

  const handler = TOOL_HANDLERS[tool.name];
  if (handler) {
    return handler(ctx);
  }
  return { ok: false, error: `Unknown tool: ${tool.name}` };
}
