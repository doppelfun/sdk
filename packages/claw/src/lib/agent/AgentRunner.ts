/**
 * Class wrapper for the agent loop. Prefer runAgent() for tree-shaking;
 * use AgentRunner when you want an instance (e.g. inject config later).
 */

import { runAgent, type AgentRunOptions } from "./agent.js";

export class AgentRunner {
  /**
   * Start the agent with the same behavior as runAgent().
   */
  run(options: AgentRunOptions = {}): Promise<void> {
    return runAgent(options);
  }

  /**
   * Static alias for runAgent — same as runAgent(opts).
   */
  static run(options: AgentRunOptions = {}): Promise<void> {
    return runAgent(options);
  }
}
