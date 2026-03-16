/**
 * Types for claw tool execution: invocation, result, context, and handler signature.
 */
import type { DoppelClient } from "@doppelfun/sdk";
import type { ClawConfig } from "../config/index.js";
import type { ClawStore } from "../state/index.js";

/** Tool name + parsed args from the LLM. */
export type ToolInvocation = { name: string; args: Record<string, unknown> };

/** Result of executing a tool: success with optional summary, or error. */
export type ExecuteToolResult =
  | { ok: true; summary?: string }
  | { ok: false; error: string };

/** Context passed to each tool handler (client, store, config, args). */
export type ToolContext = {
  client: DoppelClient;
  store: ClawStore;
  config: ClawConfig;
  args: Record<string, unknown>;
  logAction: (msg: string) => void;
};

/** Async handler that takes ToolContext and returns ExecuteToolResult. */
export type ToolHandler = (ctx: ToolContext) => Promise<ExecuteToolResult>;
