import { describe, it, expect } from "vitest";
import { getVeniceLanguageModel, patchChatCompletionsBodyForVenice } from "./venice.js";
import { testConfig } from "../../../util/testHelpers.js";

describe("getVeniceLanguageModel", () => {
  it("returns null when veniceApiKey is missing", () => {
    const config = testConfig({ llmProvider: "venice", veniceApiKey: null });
    expect(getVeniceLanguageModel(config, "venice-uncensored")).toBeNull();
  });

  it("returns null when veniceApiKey is empty string", () => {
    const config = testConfig({ llmProvider: "venice", veniceApiKey: "" });
    expect(getVeniceLanguageModel(config, "venice-uncensored")).toBeNull();
  });

  it("patches assistant+tool_calls empty content for Venice API validation", () => {
    const body: Record<string, unknown> = {
      messages: [
        {
          role: "assistant",
          content: "",
          tool_calls: [
            { id: "x", type: "function", function: { name: "get_occupants", arguments: "{}" } },
          ],
        },
      ],
    };
    patchChatCompletionsBodyForVenice(body);
    const msg = (body.messages as Array<{ content: string }>)[0];
    expect(msg.content).toBe(" ");
  });

  it("returns a language model when veniceApiKey is set", () => {
    const config = testConfig({
      llmProvider: "venice",
      veniceApiKey: "vk_test_key",
    });
    const model = getVeniceLanguageModel(config, "venice-uncensored");
    expect(model).not.toBeNull();
    expect(typeof model?.doGenerate).toBe("function");
  });
});
