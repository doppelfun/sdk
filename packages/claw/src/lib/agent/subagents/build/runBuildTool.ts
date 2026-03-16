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

/** True if the build subagent's summary indicates a build/delete completed or failed (so we clear context). */
export function isBuildCompletionSummary(summary: string): boolean {
  const lower = summary.toLowerCase();
  return (
    /\bbuilt\b/.test(lower) ||
    /build (completed|done|finished)/.test(lower) ||
    /\bdeleted\b/.test(lower) ||
    /\bfailed\b/.test(lower) ||
    /error:/.test(lower)
  );
}

/**
 * Create the run_build tool for the Obedient agent.
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
      const summary =
        typeof result.text === "string" && result.text.trim()
          ? result.text.trim().slice(0, 500)
          : "Build step completed.";

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
 * Stub run_build for the Autonomous agent.
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
