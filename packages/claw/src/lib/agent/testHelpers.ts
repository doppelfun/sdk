/**
 * Shared test helpers for agent/tick loop tests. Use a minimal ClawConfig so tests
 * don't depend on env; override only the fields under test.
 */
import type { ClawConfig } from "../config/index.js";

const BASE_TEST_CONFIG: ClawConfig = {
  tickIntervalMs: 5000,
  npcStyleIdle: true,
  ownerUserId: null,
  autonomousSoulTickMs: 45000,
  ownerNearbyRadiusM: 14,
  apiKey: "test",
  hubUrl: "http://localhost:4000",
  agentApiUrl: "http://localhost:4000",
  engineUrl: "http://localhost:2567",
  blockId: null,
  openRouterApiKey: "",
  chatLlmModel: "test",
  buildLlmModel: "test",
  wakeTickDebounceMs: 150,
  maxChatContext: 20,
  maxOwnerMessages: 10,
  hosted: false,
  tokensPerCredit: 1000,
  buildCreditMultiplier: 1.5,
  skillIds: [],
  allowBuildWithoutCredits: false,
  llmProvider: "google",
  googleApiKey: null,
  googleCloudProject: null,
  googleCloudLocation: null,
  sessionRefreshIntervalMs: 0,
  voiceId: null,
};

/** Minimal ClawConfig for unit tests. Override only fields needed by the test. */
export function testConfig(overrides: Partial<ClawConfig> = {}): ClawConfig {
  return { ...BASE_TEST_CONFIG, ...overrides };
}
