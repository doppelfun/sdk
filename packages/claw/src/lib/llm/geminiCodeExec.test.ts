import { describe, it, expect } from "vitest";
import { createGeminiClient } from "./geminiCodeExec.js";
import { testConfig } from "../../util/testHelpers.js";

describe("createGeminiClient", () => {
  it("returns null when llmProvider is openrouter", () => {
    const config = testConfig({ llmProvider: "openrouter" });
    expect(createGeminiClient(config)).toBeNull();
  });

  it("returns null when llmProvider is venice", () => {
    const config = testConfig({ llmProvider: "venice", veniceApiKey: "vk_x" });
    expect(createGeminiClient(config)).toBeNull();
  });

  it("returns null when llmProvider is google but no api key", () => {
    const config = testConfig({ llmProvider: "google", googleApiKey: null });
    expect(createGeminiClient(config)).toBeNull();
  });

  it("returns null when llmProvider is google-vertex but no project/location", () => {
    const config = testConfig({
      llmProvider: "google-vertex",
      googleCloudProject: null,
      googleCloudLocation: null,
    });
    expect(createGeminiClient(config)).toBeNull();
  });
});
