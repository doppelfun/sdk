/**
 * run_build tool: entry point from Obedient agent into the Build subagent.
 *
 * - createRunBuildTool: real implementation. Owner-only; builds prompt from
 *   buildSubagentContext + current request; runs createBuildSubagent().generate();
 *   clears or appends context based on isBuildCompletionSummary; sends summary to DM peer.
 * - createRunBuildStubTool: used by Autonomous agent; returns RUN_BUILD_STUB_MESSAGE.
 */
import { tool, zodSchema } from "ai";
import { z } from "zod/v4";
import type { DoppelClient } from "@doppelfun/sdk";
import type { ClawStore } from "../../../state/index.js";
import type { ClawConfig } from "../../../config/index.js";
import { buildChatSendOptions } from "../../../chatSendOptions.js";
import { createBuildSubagent } from "./buildSubagent.js";
import type { ExecuteToolResult } from "../../../tools/index.js";

export const RUN_BUILD_STUB_MESSAGE = "Autonomous building is not available yet.";

/**
 * Whether the build subagent's summary indicates a build/delete completed or failed.
 * When true, we clear buildSubagentContext so the next run_build starts fresh.
 *
 * @param summary - Text returned from the build subagent or last tool
 * @returns True if summary looks like "built", "added", "generated", "deleted", "failed", or "error:"
 */
export function isBuildCompletionSummary(summary: string): boolean {
  const lower = summary.toLowerCase();
  return (
    /\bbuilt\b/.test(lower) ||
    /\badded\b/.test(lower) ||
    /\bgenerated\b/.test(lower) ||
    /build (completed|done|finished)/.test(lower) ||
    /\bdeleted\b/.test(lower) ||
    /\bfailed\b/.test(lower) ||
    /error:/.test(lower)
  );
}

/**
 * Extract summary from Build subagent result: use final text, or last tool result when agent stops after a tool call.
 *
 * @param result - generate() result (text, steps; steps may have toolResults depending on SDK)
 * @returns Summary string for user and context
 */
function getSummaryFromBuildResult(result: {
  text?: string;
  steps?: Array<{ toolResults?: unknown[]; toolCalls?: unknown[] }>;
}): string {
  if (typeof result.text === "string" && result.text.trim()) {
    return result.text.trim().slice(0, 500);
  }
  const steps = result.steps;
  if (Array.isArray(steps) && steps.length > 0) {
    for (let i = steps.length - 1; i >= 0; i--) {
      const step = steps[i] as { toolResults?: unknown[] } | undefined;
      const tr = step?.toolResults;
      if (Array.isArray(tr) && tr.length > 0) {
        const last = tr[tr.length - 1];
        if (typeof last === "string") return last.slice(0, 500);
      }
    }
  }
  return "Build step completed.";
}

/**
 * Create the run_build tool for the Obedient agent. Owner-only; runs Build subagent with multi-turn context.
 *
 * @param client - Engine client (for subagent and sendChat)
 * @param store - Claw store (buildSubagentContext, lastDmPeerSessionId)
 * @param config - Claw config (ownerUserId)
 * @param onToolResult - Optional callback when a tool completes
 * @returns AI SDK tool with request string input, returns summary string
 */
export function createRunBuildTool(
  client: DoppelClient,
  store: ClawStore,
  config: ClawConfig,
  onToolResult?: (name: string, args: string, result: ExecuteToolResult) => void
) {
  return tool({
    description:
      "Run the build subagent to handle premade (city/pyramid) or custom build requests. Pass the user's build request or latest message. Returns a summary.",
    inputSchema: zodSchema(
      z.object({
        request: z.string().describe("The user's build request or latest message in the build flow."),
      })
    ),
    execute: async (
      { request },
      { abortSignal }
    ): Promise<string> => {
      const state = store.getState();
      // Owner-only: only the owner can ask the agent to build
      if (config.ownerUserId && state.lastTriggerUserId !== config.ownerUserId) {
        return "Sorry, I only perform tasks for my owner.";
      }
      // Multi-turn: prepend previous build conversation so subagent knows what was already asked
      const ctx = state.buildSubagentContext;
      const currentRequest = request.trim() || "What would you like to build? Premade (city/pyramid) or custom?";
      const prompt =
        ctx.length === 0
          ? currentRequest
          : `Previous build conversation:\n${ctx
              .map((e) => `Agent: ${e.agentSummary}\nUser: ${e.userMessage}`)
              .join("\n\n")}\n\nCurrent user message: ${currentRequest}`;

      const buildAgent = createBuildSubagent(client, store, config, (name, args, res) => {
        onToolResult?.(name, args, res as ExecuteToolResult);
      });
      const result = await buildAgent.generate({
        prompt,
        options: abortSignal ? { abortSignal } : {},
      });
      const summary = getSummaryFromBuildResult(result);

      if (isBuildCompletionSummary(summary)) {
        store.clearBuildSubagentContext();
      } else {
        store.appendBuildSubagentExchange(summary, currentRequest);
      }

      const targetSessionId = store.getState().lastDmPeerSessionId ?? null;
      if (targetSessionId) {
        client.sendChat?.(
          summary,
          buildChatSendOptions({ targetSessionId, voiceId: config.voiceId }) ?? undefined
        );
      }
      return summary;
    },
    toModelOutput: ({ output }) => ({
      type: "text" as const,
      value: typeof output === "string" ? output : "Build completed.",
    }),
  });
}

/**
 * Stub run_build for the Autonomous agent. Always returns RUN_BUILD_STUB_MESSAGE.
 *
 * @returns AI SDK tool that does not call the Build subagent
 */
export function createRunBuildStubTool() {
  return tool({
    description: "Build is not available in autonomous mode; use to decline if the user asks to build.",
    inputSchema: zodSchema(
      z.object({
        request: z.string().optional().describe("Unused; autonomous build is stubbed."),
      })
    ),
    execute: async (): Promise<string> => RUN_BUILD_STUB_MESSAGE,
    toModelOutput: ({ output }) => ({
      type: "text" as const,
      value: typeof output === "string" ? output : RUN_BUILD_STUB_MESSAGE,
    }),
  });
}
