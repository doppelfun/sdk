/**
 * Wrapper that holds an Agent instance so you can run() and later stop().
 * For one-off run without stop, use runAgent() from agent.js.
 */

import { Agent } from "./Agent.js";
import type { AgentRunOptions } from "./index.js";

export class AgentRunner {
  private agent: Agent | null = null;

  /** Start the agent; same behavior as runAgent(). Resolves when connected. */
  async run(options: AgentRunOptions = {}): Promise<void> {
    this.agent = new Agent();
    await this.agent.run(options);
  }

  /** Stop the agent: clear timers and disconnect. No-op if not running. */
  stop(): void {
    if (this.agent) {
      this.agent.stop();
      this.agent = null;
    }
  }
}
