/**
 * @doppelfun/claw — LLM-driven agent runtime.
 *
 * **Library entrypoint:** `import { runAgent } from "@doppelfun/claw"` (or this file).
 * To run the agent programmatically, call `runAgent(options)` or `new AgentRunner().run(options)`.
 *
 * **CLI entrypoint:** `doppel-claw` (bin) or `node dist/cli.js` — see README.
 * Public API below; implementation lives under lib/ and util/.
 */

export const CLAW_VERSION = "0.1.0";

export { runAgent, Agent, type AgentRunOptions, type ToolCallResult } from "./lib/agent/index.js";
export { AgentRunner } from "./lib/agent/AgentRunner.js";
export { loadConfig, type ClawConfig, type LlmProviderId } from "./lib/config/index.js";
export { joinBlock, createBlock, HubClient } from "./lib/hub/index.js";
export {
  createInitialState,
  createClawStore,
  type ClawState,
  type ClawStore,
  type ClawStoreApi,
} from "./lib/state/index.js";
export { executeTool, type ToolInvocation, type ExecuteToolResult } from "./lib/tools/index.js";
export {
  createLlmProvider,
  type LlmProvider,
  type LlmProviderKind,
  type BuildIntentResult,
} from "./lib/llm/index.js";
