import { describe, it, expect, vi } from "vitest";
import type { DoppelClient } from "@doppelfun/sdk";
import { createInitialState } from "../state/state.js";
import { executeTool } from "./tools.js";
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
    const state = createInitialState("0_0");
    const res = await executeTool(client, state, minimalConfig(), { name: "move", args: {} });
    expect(res.ok).toBe(true);
    expect(sendInput).toHaveBeenCalledWith(
      expect.objectContaining({ moveX: 0, moveZ: 0 })
    );
  });

  it("returns error for unknown tool", async () => {
    const client = {} as DoppelClient;
    const state = createInitialState("0_0");
    const res = await executeTool(client, state, minimalConfig(), {
      name: "nonexistent_tool",
      args: {},
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("Unknown tool");
  });

  it("join_block calls sendJoin and updates state.blockSlotId", async () => {
    const sendJoin = vi.fn();
    const client = { sendJoin } as unknown as DoppelClient;
    const state = createInitialState("0_0");
    expect(state.blockSlotId).toBe("0_0");
    const res = await executeTool(client, state, minimalConfig(), {
      name: "join_block",
      args: { blockSlotId: "1_0" },
    });
    expect(res.ok).toBe(true);
    expect(sendJoin).toHaveBeenCalledWith("1_0");
    expect(state.blockSlotId).toBe("1_0");
    expect(state.lastError).toBeNull();
  });

  it("get_occupants calls client.getOccupants and sets state.occupants", async () => {
    const occupants = [{ clientId: "s1", username: "Alice", type: "user" as const }];
    const getOccupants = vi.fn().mockResolvedValue(occupants);
    const client = { getOccupants } as unknown as DoppelClient;
    const state = createInitialState("0_0");
    state.mySessionId = "s1";
    const res = await executeTool(client, state, minimalConfig(), {
      name: "get_occupants",
      args: {},
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.summary).toContain("1 occupants");
    expect(getOccupants).toHaveBeenCalled();
    expect(state.occupants).toEqual(occupants);
  });

  it("chat calls sendChat and sets lastTickSentChat", async () => {
    const sendChat = vi.fn();
    const client = { sendChat } as unknown as DoppelClient;
    const state = createInitialState("0_0");
    const res = await executeTool(client, state, minimalConfig(), {
      name: "chat",
      args: { text: "hello world" },
    });
    expect(res.ok).toBe(true);
    expect(sendChat).toHaveBeenCalledWith("hello world", undefined);
    expect(state.lastTickSentChat).toBe(true);
    expect(state.lastAgentChatMessage).toBe("hello world");
  });

  it("chat with targetSessionId passes options to sendChat", async () => {
    const sendChat = vi.fn();
    const client = { sendChat } as unknown as DoppelClient;
    const state = createInitialState("0_0");
    const res = await executeTool(client, state, minimalConfig(), {
      name: "chat",
      args: { text: "dm reply", targetSessionId: "peer-session" },
    });
    expect(res.ok).toBe(true);
    expect(sendChat).toHaveBeenCalledWith("dm reply", { targetSessionId: "peer-session" });
    expect(state.lastDmPeerSessionId).toBe("peer-session");
  });

  it("emote calls sendEmote with emoteId when provided", async () => {
    const sendEmote = vi.fn();
    const client = { sendEmote } as unknown as DoppelClient;
    const state = createInitialState("0_0");
    const res = await executeTool(client, state, minimalConfig(), {
      name: "emote",
      args: { emoteId: "wave" },
    });
    expect(res.ok).toBe(true);
    expect(sendEmote).toHaveBeenCalledWith("wave");
  });

  it("get_world_entities calls getSnapshot and returns summary with entity list", async () => {
    const entities = [
      { id: "pyr-0", entityType: "cube", x: 10, y: 0, z: 5, width: 2, depth: 2 },
      { id: "grass-1", entityType: "grass", x: 50, z: 50 },
    ];
    const getSnapshot = vi.fn().mockResolvedValue({ worldVersion: 1, entities });
    const client = { getSnapshot } as unknown as DoppelClient;
    const state = createInitialState("0_0");
    const res = await executeTool(client, state, minimalConfig(), {
      name: "get_world_entities",
      args: {},
    });
    expect(res.ok).toBe(true);
    expect(getSnapshot).toHaveBeenCalled();
    expect(state.lastWorldEntities).toHaveLength(2);
    expect(state.lastWorldEntities?.[0]?.id).toBe("pyr-0");
    expect(typeof (res as { summary: string }).summary).toBe("string");
    expect((res as { summary: string }).summary).toContain("pyr-0");
  });

  it("move_to_entity uses cached lastWorldEntities and calls sendGoto", async () => {
    const sendGoto = vi.fn();
    const sendInput = vi.fn();
    const client = { sendGoto, sendInput } as unknown as DoppelClient;
    const state = createInitialState("0_0");
    state.lastWorldEntities = [
      { id: "pyr-0", entityType: "cube", x: 10, z: 5, width: 2, depth: 2 },
    ];
    state.myPosition = { x: 0, y: 0, z: 0 };
    const res = await executeTool(client, state, minimalConfig(), {
      name: "move_to_entity",
      args: { entityId: "pyr-0" },
    });
    expect(res.ok).toBe(true);
    expect(state.movementTarget).toEqual({ x: 11, z: 6 });
    expect(sendGoto).toHaveBeenCalledWith(11, 6, { x: 0, z: 0 });
  });

  it("move_to_entity returns error when entityId not in cache and getSnapshot has no match", async () => {
    const getSnapshot = vi.fn().mockResolvedValue({ worldVersion: 1, entities: [] });
    const client = { getSnapshot } as unknown as DoppelClient;
    const state = createInitialState("0_0");
    state.myPosition = { x: 50, y: 0, z: 50 };
    const res = await executeTool(client, state, minimalConfig(), {
      name: "move_to_entity",
      args: { entityId: "nonexistent" },
    });
    expect(res.ok).toBe(false);
    expect((res as { error: string }).error).toContain("no entity");
  });
});
