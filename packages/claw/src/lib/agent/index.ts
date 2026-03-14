/**
 * Agent module: runAgent(), Agent class, and types.
 * Agent holds the full lifecycle (run/stop); runAgent is the one-shot entrypoint.
 */

import type { AgentRunOptions } from "./types.js";
import { Agent } from "./Agent.js";

export type { ToolCallResult, AgentRunOptions } from "./types.js";
export { Agent } from "./Agent.js";

/**
 * Start the agent: bootstrap, connect, run tick loop and message handlers.
 * Resolves when connect() completes; rejects on bootstrap/join error.
 * For programmatic stop(), use `const agent = new Agent(); await agent.run(options); agent.stop();`.
 */
export async function runAgent(options: AgentRunOptions = {}): Promise<void> {
  const agent = new Agent();
  await agent.run(options);
}
