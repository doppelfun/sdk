/**
 * Tool execution types. Handlers receive ToolContext and return ExecuteToolResult.
 */

import type { DoppelClient } from "@doppelfun/sdk";
import type { ClawConfig } from "../config/config.js";
import type { ClawState } from "../state/state.js";

export type ToolInvocation = { name: string; args: Record<string, unknown> };

export type ExecuteToolResult =
  | { ok: true; summary?: string }
  | { ok: false; error: string };

export type ToolContext = {
  client: DoppelClient;
  state: ClawState;
  config: ClawConfig;
  args: Record<string, unknown>;
  logAction: (msg: string) => void;
};

export type ToolHandler = (ctx: ToolContext) => Promise<ExecuteToolResult>;
