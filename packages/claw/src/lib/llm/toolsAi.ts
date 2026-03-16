import { dynamicTool, zodSchema, type LanguageModel } from "ai";
import type { DoppelClient } from "@doppelfun/sdk";
import { CLAW_TOOL_REGISTRY, getToolSchema } from "../tools/toolsZod.js";
import { executeTool, type ExecuteToolResult } from "../tools/index.js";
import type { ClawStore } from "../state/index.js";
import type { ClawConfig } from "../config/index.js";
import { createLlmProvider } from "./provider.js";
import type { Usage } from "./usage.js";
import { clawLog } from "../log.js";

function toRecord(args: unknown): Record<string, unknown> {
  if (args && typeof args === "object" && !Array.isArray(args)) return args as Record<string, unknown>;
  return {};
}

function clawTool(
  name: string,
  description: string,
  schema: (typeof CLAW_TOOL_REGISTRY)[number]["schema"],
  client: DoppelClient,
  store: ClawStore,
  config: ClawConfig,
  onResult?: (name: string, args: string, result: ExecuteToolResult) => void
) {
  return dynamicTool({
    description,
    inputSchema: zodSchema(schema),
    execute: async (args: unknown) => {
      clawLog("tool executing", name);
      const record = toRecord(args);
      const zodSchemaForTool = getToolSchema(name);
      const payload = zodSchemaForTool
        ? (() => {
            const parsed = zodSchemaForTool.safeParse(record);
            if (!parsed.success) {
              const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
              throw new Error(`Invalid tool arguments: ${msg}`);
            }
            return parsed.data as Record<string, unknown>;
          })()
        : record;
      const argsJson = JSON.stringify(payload);
      let result: ExecuteToolResult;
      try {
        result = await executeTool(client, store, config, { name, args: payload });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        result = { ok: false, error: msg };
      }
      onResult?.(name, argsJson, result);
      if (!result.ok) throw new Error(result.error);
      return result.summary ?? "ok";
    },
  });
}

export function buildClawToolSet(
  client: DoppelClient,
  store: ClawStore,
  config: ClawConfig,
  options: {
    allowOnlyTools?: readonly string[];
    onToolResult?: (name: string, args: string, result: ExecuteToolResult) => void;
  }
): Record<string, ReturnType<typeof dynamicTool>> {
  let entries = CLAW_TOOL_REGISTRY;
  if (options.allowOnlyTools?.length) {
    const allow = new Set(options.allowOnlyTools);
    entries = entries.filter((t) => allow.has(t.name));
  }
  const tools: Record<string, ReturnType<typeof dynamicTool>> = {};
  for (const t of entries) {
    tools[t.name] = clawTool(t.name, t.description, t.schema, client, store, config, options.onToolResult);
  }
  return tools;
}

export type RunTickLlmResult =
  | { ok: true; usage: Usage | null; hadToolCalls: boolean; replyText?: string | null }
  | { ok: false; error: string };

export function resolveTickLanguageModel(config: ClawConfig, modelId?: string): LanguageModel | null {
  const provider = createLlmProvider(config);
  return provider.getChatModel(modelId ?? config.chatLlmModel);
}

/** Resolve build (Pro) model for the Build subagent. */
export function resolveBuildLanguageModel(config: ClawConfig): LanguageModel | null {
  const provider = createLlmProvider(config);
  return provider.getChatModel(config.buildLlmModel);
}
