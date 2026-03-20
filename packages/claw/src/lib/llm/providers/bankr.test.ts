import { describe, it, expect } from "vitest";
import { getBankrLanguageModel } from "./bankr.js";
import { testConfig } from "../../../util/testHelpers.js";

describe("getBankrLanguageModel", () => {
  it("returns null when bankrLlmApiKey is missing", () => {
    const config = testConfig({ llmProvider: "bankr", bankrLlmApiKey: null });
    expect(getBankrLanguageModel(config, "claude-opus-4.6")).toBeNull();
  });

  it("returns null when bankrLlmApiKey is empty string", () => {
    const config = testConfig({ llmProvider: "bankr", bankrLlmApiKey: "" });
    expect(getBankrLanguageModel(config, "claude-opus-4.6")).toBeNull();
  });

  it("returns a language model when bankrLlmApiKey is set", () => {
    const config = testConfig({
      llmProvider: "bankr",
      bankrLlmApiKey: "bk_test_key",
    });
    const model = getBankrLanguageModel(config, "claude-opus-4.6");
    expect(model).not.toBeNull();
    expect(typeof model?.doGenerate).toBe("function");
  });
});
