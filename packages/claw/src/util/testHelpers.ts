import type { ClawConfig } from "../lib/config/index.js";

/** Minimal config for tests (no env). */
export function testConfig(overrides: Partial<ClawConfig> = {}): ClawConfig {
  return {
    apiKey: "test-key",
    agentId: null,
    hubUrl: "http://localhost:4000",
    agentApiUrl: "http://localhost:4000",
    engineUrl: "http://localhost:2567",
    blockId: null,
    openRouterApiKey: "",
    bankrLlmApiKey: null,
    chatLlmModel: "test-model",
    buildLlmModel: "test-build-model",
    ownerUserId: null,
    maxChatContext: 20,
    maxOwnerMessages: 10,
    hosted: false,
    tokensPerCredit: 1000,
    skillIds: [],
    llmProvider: "openrouter",
    googleApiKey: null,
    googleCloudProject: null,
    googleCloudLocation: null,
    ownerNearbyRadiusM: 14,
    chatNearbyRadiusM: 4,
    autonomousSoulTickMs: 45000,
    autonomousLlmCooldownMs: 25000,
    voiceId: null,
    voiceEnabled: true,
    dailyCreditBudget: 0,
    soul: null,
    skipCreditReport: true,
    ...overrides,
  };
}
