import { describe, it, expect, vi } from "vitest";
import type { DoppelClient } from "@doppelfun/sdk";
import { createClawStore } from "../state/index.js";
import { buildClawToolSet } from "../llm/toolsAi.js";
import type { ClawConfig } from "../config/index.js";

function minimalConfig(): ClawConfig {
  return {
    apiKey: "k",
    hubUrl: "http://localhost",
    agentApiUrl: "http://localhost",
    engineUrl: "http://localhost",
    blockId: null,
    openRouterApiKey: "or",
    chatLlmModel: "m",
    buildLlmModel: "m",
    ownerUserId: null,
    tickIntervalMs: 5000,
    wakeTickDebounceMs: 150,
    maxChatContext: 20,
    maxOwnerMessages: 10,
    hosted: false,
    tokensPerCredit: 1000,
    buildCreditMultiplier: 1.5,
    skillIds: [],
    allowBuildWithoutCredits: false,
    npcStyleIdle: true,
    ownerNearbyRadiusM: 14,
    autonomousSoulTickMs: 0,
    sessionRefreshIntervalMs: 0,
    llmProvider: "openrouter",
    googleApiKey: null,
    googleCloudProject: null,
    googleCloudLocation: null,
  };
}

describe("buildClawToolSet", () => {
  it("includes chat when lastTickSentChat is false", () => {
    const client = {} as DoppelClient;
    const store = createClawStore("0_0");
    store.setLastTickSentChat(false);
    const tools = buildClawToolSet(client, store, minimalConfig(), {});
    expect(tools.chat).toBeDefined();
  });

  it("allowOnlyTools restricts registry", () => {
    const client = {} as DoppelClient;
    const store = createClawStore("0_0");
    const tools = buildClawToolSet(client, store, minimalConfig(), {
      allowOnlyTools: ["move", "join_block"],
    });
    expect(tools.move).toBeDefined();
    expect(tools.join_block).toBeDefined();
    expect(tools.chat).toBeUndefined();
    expect(tools.generate_procedural).toBeUndefined();
  });

  it("omits chat when omitChat option is true (runTick passes lastTickSentChat)", () => {
    const client = {} as DoppelClient;
    const store = createClawStore("0_0");
    const tools = buildClawToolSet(client, store, minimalConfig(), { omitChat: true });
    expect(tools.chat).toBeUndefined();
  });

  it("move tool execute validates with Zod then calls sendInput", async () => {
    const sendInput = vi.fn();
    const client = { sendInput } as unknown as DoppelClient;
    const store = createClawStore("0_0");
    const tools = buildClawToolSet(client, store, minimalConfig(), {});
    const moveTool = tools.move;
    expect(moveTool).toBeDefined();
    await moveTool.execute({ moveX: 0.3, moveZ: 0 });
    expect(sendInput).toHaveBeenCalledWith(
      expect.objectContaining({ moveX: 0.3, moveZ: 0, sprint: false, jump: false })
    );
  });

  it("join_block execute throws without blockSlotId (Zod)", async () => {
    const client = { sendJoin: vi.fn() } as unknown as DoppelClient;
    const store = createClawStore("0_0");
    const tools = buildClawToolSet(client, store, minimalConfig(), {});
    await expect(tools.join_block.execute({})).rejects.toThrow(/Invalid tool arguments/);
    expect(client.sendJoin).not.toHaveBeenCalled();
  });

  it("move tool execute throws on invalid args", async () => {
    const client = { sendInput: vi.fn() } as unknown as DoppelClient;
    const store = createClawStore("0_0");
    const tools = buildClawToolSet(client, store, minimalConfig(), {});
    await expect(tools.move.execute({ moveX: "bad", moveZ: 0 })).rejects.toThrow(/Invalid tool arguments/);
    expect(client.sendInput).not.toHaveBeenCalled();
  });
});
