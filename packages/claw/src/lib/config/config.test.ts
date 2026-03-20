import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "./config.js";

const envSnapshot: Record<string, string | undefined> = {};

function captureEnv(): void {
  const keys = [
    "DOPPEL_AGENT_API_KEY",
    "LLM_PROVIDER",
    "BANKR_LLM_API_KEY",
    "OPENROUTER_API_KEY",
    "GOOGLE_API_KEY",
  ];
  for (const k of keys) {
    envSnapshot[k] = process.env[k];
  }
}

function restoreEnv(): void {
  for (const [k, v] of Object.entries(envSnapshot)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe("loadConfig", () => {
  beforeEach(() => {
    captureEnv();
  });

  afterEach(() => {
    restoreEnv();
  });

  describe("LLM_PROVIDER=bankr", () => {
    it("returns llmProvider bankr and bankrLlmApiKey when BANKR_LLM_API_KEY is set", () => {
      process.env.DOPPEL_AGENT_API_KEY = "test-agent-key";
      process.env.LLM_PROVIDER = "bankr";
      process.env.BANKR_LLM_API_KEY = "bk_test_key";

      const config = loadConfig();

      expect(config.llmProvider).toBe("bankr");
      expect(config.bankrLlmApiKey).toBe("bk_test_key");
      expect(config.chatLlmModel).toBe("claude-sonnet-4-20250514");
      expect(config.buildLlmModel).toBe("claude-opus-4.6");
    });

    it("throws when BANKR_LLM_API_KEY is missing", () => {
      process.env.DOPPEL_AGENT_API_KEY = "test-agent-key";
      process.env.LLM_PROVIDER = "bankr";
      delete process.env.BANKR_LLM_API_KEY;

      expect(() => loadConfig()).toThrow("BANKR_LLM_API_KEY is required when LLM_PROVIDER is bankr");
    });

    it("throws when BANKR_LLM_API_KEY is empty string", () => {
      process.env.DOPPEL_AGENT_API_KEY = "test-agent-key";
      process.env.LLM_PROVIDER = "bankr";
      process.env.BANKR_LLM_API_KEY = "   ";

      expect(() => loadConfig()).toThrow("BANKR_LLM_API_KEY is required when LLM_PROVIDER is bankr");
    });
  });
});
