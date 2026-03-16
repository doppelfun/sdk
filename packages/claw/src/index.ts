/**
 * @doppelfun/claw — Wake-driven agent with Mistreevous behaviour tree.
 * @see docs/PLAN-AGENT-WAKE-DRIVEN.md
 */

export { createAgentLoop, createTreeAgent, TREE_DEFINITION, type AgentLoop, type TreeAgentContext } from "./lib/tree/index.js";
export { requestWake, requestCronWake, type WakeType, type WakePayload } from "./wake.js";
export { loadConfig, type ClawConfig, type LlmProviderId } from "./lib/config/index.js";
export {
  createClawStore,
  createInitialState,
  type ClawState,
  type ClawStore,
  type ClawStoreApi,
  type ChatEntry,
  type OwnerMessage,
  type PendingScheduledTask,
  type Position3,
  type BuildTarget,
  type BlockDocument,
} from "./lib/state/index.js";
export { createRunner, type RunnerOptions } from "./runner.js";
export { handleChatMessage, type ChatPayload } from "./lib/chat/chatHandler.js";
export { buildSystemContent, buildUserMessage } from "./lib/prompts/index.js";
export { runObedientAgentTick } from "./lib/agent/obedientAgent.js";
export { runAutonomousAgentTick } from "./lib/agent/autonomousAgent.js";
export {
  getAgentProfile,
  reportUsage,
  reportVoiceUsage,
  checkBalance,
  joinBlock,
  applyHubProfileToConfig,
  setCachedBalance,
  type HubAgentProfile,
  type ReportUsageResult,
  type CheckBalanceResult,
  type JoinBlockResult,
} from "./lib/hub/index.js";
export {
  reportUsageToHub,
  reportVoiceUsageToHub,
  hasEnoughCredits,
  refreshBalance,
  MIN_BALANCE_THRESHOLD,
} from "./lib/credits/index.js";
export {
  bootstrapAgent,
  createSession,
  getDefaultBlockId,
  type BootstrapResult,
  type SessionResult,
} from "./bootstrap.js";
export {
  startCronScheduler,
  type CronTaskDef,
  type CronSchedulerOptions,
} from "./lib/cron/index.js";
