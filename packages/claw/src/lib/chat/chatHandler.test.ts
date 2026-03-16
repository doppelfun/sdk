import { describe, it, expect } from "vitest";
import { handleChatMessage } from "./chatHandler.js";
import { createClawStore } from "../state/index.js";
import { testConfig } from "../../util/testHelpers.js";

describe("handleChatMessage", () => {
  it("pushes chat and requests wake when message is from owner", () => {
    const store = createClawStore("0_0");
    store.setMySessionId("my-session");
    store.clearWake();
    const config = testConfig({ ownerUserId: "owner-1" });
    handleChatMessage(store, config, {
      userId: "owner-1",
      sessionId: "owner-session",
      message: "Build a house",
      username: "Player",
      channelId: "dm:owner-session:my-session",
      targetSessionId: "my-session",
    });
    const state = store.getState();
    expect(state.chat).toHaveLength(1);
    expect(state.chat[0]!.message).toBe("Build a house");
    expect(state.ownerMessages).toHaveLength(1);
    expect(state.wakePending).toBe(true);
    expect(state.lastTriggerUserId).toBe("owner-1");
  });

  it("does not wake when message is from self", () => {
    const store = createClawStore("0_0");
    store.setMySessionId("my-session");
    store.clearWake();
    const config = testConfig();
    handleChatMessage(store, config, {
      sessionId: "my-session",
      message: "I said something",
      username: "Me",
    });
    expect(store.getState().chat).toHaveLength(0);
    expect(store.getState().wakePending).toBe(false);
  });

  it("pushes chat even when not owner (no wake if not DM)", () => {
    const store = createClawStore("0_0");
    store.setMySessionId("my-session");
    store.clearWake();
    const config = testConfig({ ownerUserId: "owner-1" });
    handleChatMessage(store, config, {
      userId: "other-user",
      sessionId: "other-session",
      message: "Hi",
      username: "Other",
      channelId: "global",
    });
    expect(store.getState().chat).toHaveLength(1);
    expect(store.getState().wakePending).toBe(false);
  });
});
