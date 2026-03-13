/**
 * @doppelfun/claw — LLM-driven agent runtime.
 * Public API is stable; implementation lives under lib/ and util/.
 */

export const CLAW_VERSION = "0.1.0";

export { runAgent, type AgentRunOptions, type ToolCallResult } from "./lib/agent/agent.js";
export { AgentRunner } from "./lib/agent/AgentRunner.js";
export { loadConfig, type ClawConfig, type LlmProviderId } from "./lib/config/config.js";
export { joinBlock, createBlock, HubClient } from "./lib/hub/hub.js";
export { createInitialState, type ClawState } from "./lib/state/state.js";
export { executeTool, type ToolInvocation, type ExecuteToolResult } from "./lib/tools/index.js";
export {
  createLlmProvider,
  type LlmProvider,
  type LlmProviderKind,
  type BuildIntentResult,
} from "./lib/llm/provider.js";
