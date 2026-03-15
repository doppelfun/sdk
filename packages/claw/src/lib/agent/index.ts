/**
 * Agent module: runAgent(), DoppelAgent class, and types.
 * DoppelAgent holds the full lifecycle (run/stop); runAgent is the one-shot entrypoint.
 */

import type { AgentRunOptions } from "./types.js";
import { DoppelAgent } from "./DoppelAgent.js";

export type { ToolCallResult, AgentRunOptions } from "./types.js";
export { DoppelAgent } from "./DoppelAgent.js";
export {
  createClawAgent,
  runClawAgentTick,
  type ClawAgentUIMessage,
} from "./clawAgent.js";

/**
 * Start the agent: bootstrap, connect, run tick loop and message handlers.
 * Resolves when connect() completes; rejects on bootstrap/join error.
 * For programmatic stop(), use `const agent = new DoppelAgent(); await agent.run(options); agent.stop();`.
 */
export async function runAgent(options: AgentRunOptions = {}): Promise<void> {
  const agent = new DoppelAgent();
  await agent.run(options);
}
