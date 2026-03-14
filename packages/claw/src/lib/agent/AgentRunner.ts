/**
 * Wrapper that holds a DoppelAgent instance so you can run() and later stop().
 * For one-off run without stop, use runAgent() from agent.js.
 */

import { DoppelAgent } from "./DoppelAgent.js";
import type { AgentRunOptions } from "./index.js";

export class AgentRunner {
  private agent: DoppelAgent | null = null;

  /** Start the agent; same behavior as runAgent(). Resolves when connected. */
  async run(options: AgentRunOptions = {}): Promise<void> {
    this.agent = new DoppelAgent();
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
