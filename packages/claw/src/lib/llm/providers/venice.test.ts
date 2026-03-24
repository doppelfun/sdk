import { describe, it, expect } from "vitest";
import {
  getVeniceLanguageModel,
  patchChatCompletionsBodyForVenice,
  patchChatCompletionsResponseFromVenice,
} from "./venice.js";
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

  it("moves JSON tool array from assistant content into tool_calls", () => {
    const raw =
      '[{"name": "run_recipe", "arguments": {"kind": "city"}}]' as const;
    const data: Record<string, unknown> = {
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: raw,
            refusal: null,
          },
          finish_reason: "stop",
        },
      ],
    };
    const patched = patchChatCompletionsResponseFromVenice(data);
    expect(patched).not.toBe(data);
    const msg = (patched.choices as Array<{ message: Record<string, unknown> }>)[0].message;
    expect(msg.content).toBeNull();
    const tc = msg.tool_calls as Array<{ function: { name: string; arguments: string } }>;
    expect(tc).toHaveLength(1);
    expect(tc[0].function.name).toBe("run_recipe");
    expect(JSON.parse(tc[0].function.arguments)).toEqual({ kind: "city" });
  });

  it("does not patch when tool_calls already present", () => {
    const data: Record<string, unknown> = {
      choices: [
        {
          message: {
            role: "assistant",
            content: "ignored",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "chat", arguments: "{}" },
              },
            ],
          },
        },
      ],
    };
    expect(patchChatCompletionsResponseFromVenice(data)).toBe(data);
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
