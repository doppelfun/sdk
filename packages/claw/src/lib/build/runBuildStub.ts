/**
 * Stub run_build tool for the Autonomous agent. Build is not available in autonomous mode.
 */
import { tool, zodSchema } from "ai";
import { z } from "zod/v4";

export const RUN_BUILD_STUB_MESSAGE = "Building is not available in autonomous mode.";

/**
 * Stub run_build for the Autonomous agent. Always returns RUN_BUILD_STUB_MESSAGE.
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
