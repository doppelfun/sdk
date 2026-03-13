import { describe, it, expect, vi } from "vitest";
import type { DoppelClient } from "@doppelfun/sdk";
import { createClawStore } from "../state/index.js";
import { executeTool } from "./index.js";
import type { ClawConfig } from "../config/config.js";

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

describe("executeTool", () => {
  it("move with empty args coerces to 0,0 and calls sendInput", async () => {
    const sendInput = vi.fn();
    const client = { sendInput } as unknown as DoppelClient;
    const store = createClawStore("0_0");
    const res = await executeTool(client, store, minimalConfig(), { name: "move", args: {} });
    expect(res.ok).toBe(true);
    expect(sendInput).toHaveBeenCalledWith(
      expect.objectContaining({ moveX: 0, moveZ: 0 })
    );
  });

  it("returns error for unknown tool", async () => {
    const client = {} as DoppelClient;
    const store = createClawStore("0_0");
    const res = await executeTool(client, store, minimalConfig(), {
      name: "nonexistent_tool",
      args: {},
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("Unknown tool");
  });

  it("join_block calls sendJoin and updates state.blockSlotId", async () => {
    const sendJoin = vi.fn();
    const client = { sendJoin } as unknown as DoppelClient;
    const store = createClawStore("0_0");
    expect(store.getState().blockSlotId).toBe("0_0");
    const res = await executeTool(client, store, minimalConfig(), {
      name: "join_block",
      args: { blockSlotId: "1_0" },
    });
    expect(res.ok).toBe(true);
    expect(sendJoin).toHaveBeenCalledWith("1_0");
    expect(store.getState().blockSlotId).toBe("1_0");
    expect(store.getState().lastError).toBeNull();
  });

  it("get_occupants calls client.getOccupants and sets state.occupants", async () => {
    const occupants = [{ clientId: "s1", username: "Alice", type: "user" as const }];
    const getOccupants = vi.fn().mockResolvedValue(occupants);
    const client = { getOccupants } as unknown as DoppelClient;
    const store = createClawStore("0_0");
    store.setMySessionId("s1");
    const res = await executeTool(client, store, minimalConfig(), {
      name: "get_occupants",
      args: {},
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.summary).toContain("1 occupants");
    expect(getOccupants).toHaveBeenCalled();
    expect(store.getState().occupants).toEqual(occupants);
  });

  it("chat calls sendChat and sets lastTickSentChat", async () => {
    const sendChat = vi.fn();
    const sendSpeak = vi.fn();
    const client = { sendChat, sendSpeak } as unknown as DoppelClient;
    const store = createClawStore("0_0");
    const res = await executeTool(client, store, minimalConfig(), {
      name: "chat",
      args: { text: "hello world" },
    });
    expect(res.ok).toBe(true);
    expect(sendChat).toHaveBeenCalledWith("hello world", undefined);
    expect(store.getState().lastTickSentChat).toBe(true);
    expect(store.getState().lastAgentChatMessage).toBe("hello world");
  });

  it("chat with targetSessionId passes options to sendChat", async () => {
    const sendChat = vi.fn();
    const sendSpeak = vi.fn();
    const client = { sendChat, sendSpeak } as unknown as DoppelClient;
    const store = createClawStore("0_0");
    const res = await executeTool(client, store, minimalConfig(), {
      name: "chat",
      args: { text: "dm reply", targetSessionId: "peer-session" },
    });
    expect(res.ok).toBe(true);
    expect(sendChat).toHaveBeenCalledWith("dm reply", { targetSessionId: "peer-session" });
    expect(store.getState().lastDmPeerSessionId).toBe("peer-session");
  });

  it("emote calls sendEmote with emoteId when provided", async () => {
    const sendEmote = vi.fn();
    const client = { sendEmote } as unknown as DoppelClient;
    const store = createClawStore("0_0");
    const res = await executeTool(client, store, minimalConfig(), {
      name: "emote",
      args: { emoteId: "wave" },
    });
    expect(res.ok).toBe(true);
    expect(sendEmote).toHaveBeenCalledWith("wave");
  });
});
