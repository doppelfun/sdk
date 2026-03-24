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

  it("ignores duplicate message (same sessionId + message + timestamp) so agent does not re-do", () => {
    const store = createClawStore("0_0");
    store.setMySessionId("my-session");
    store.clearWake();
    const config = testConfig({ ownerUserId: "owner-1" });
    const ts = 1234567890;
    const payload = {
      userId: "owner-1",
      sessionId: "owner-session",
      message: "Build a house",
      username: "Player",
      channelId: "dm:owner-session:my-session",
      targetSessionId: "my-session",
      createdAt: ts,
    };
    handleChatMessage(store, config, payload);
    expect(store.getState().chat).toHaveLength(1);
    handleChatMessage(store, config, payload);
    expect(store.getState().chat).toHaveLength(1);
  });

  it("allows same message again when sent at different times (idempotency includes timestamp)", () => {
    const store = createClawStore("0_0");
    store.setMySessionId("my-session");
    store.clearWake();
    const config = testConfig({ ownerUserId: "owner-1" });
    const base = {
      userId: "owner-1",
      sessionId: "owner-session",
      message: "Delete everything",
      username: "Player",
      channelId: "dm:owner-session:my-session",
      targetSessionId: "my-session",
    };
    handleChatMessage(store, config, { ...base, createdAt: 1000 });
    expect(store.getState().chat).toHaveLength(1);
    handleChatMessage(store, config, { ...base, createdAt: 2000 });
    expect(store.getState().chat).toHaveLength(2);
  });

  it("processes peer DM when text matches our last greeting (both agents say Hi)", () => {
    const store = createClawStore("0_0");
    store.setMySessionId("agent-a-session");
    store.clearWake();
    store.setState({
      lastAgentChatMessage: "Hi!",
      conversationPhase: "waiting_for_reply",
      conversationPeerSessionId: "agent-b-session",
    });
    const config = testConfig();
    handleChatMessage(store, config, {
      userId: "agent-b-user",
      sessionId: "agent-b-session",
      message: "Hi!",
      username: "AgentB",
      channelId: "dm:agent-a-session:agent-b-session",
      targetSessionId: "agent-a-session",
      createdAt: 1_700_000_001,
    });
    expect(store.getState().conversationPhase).toBe("can_reply");
    expect(store.getState().wakePending).toBe(true);
  });

  it("does not wake bystander when agent-agent DM is broadcast (only recipient wakes)", () => {
    // Server broadcasts agent A -> agent B DM to whole room; channelId is dm:A:B, targetSessionId is B.
    // Agent C (bystander) must not treat as "DM for me" and must not wake.
    const storeBystander = createClawStore("0_0");
    storeBystander.setMySessionId("agent-c-session");
    storeBystander.clearWake();
    const config = testConfig({ ownerUserId: "owner-1" });
    const agentToAgentDmPayload = {
      userId: "agent-a",
      sessionId: "agent-a-session",
      message: "Hey B, over here!",
      username: "AgentA",
      channelId: "dm:agent-a-session:agent-b-session",
      targetSessionId: "agent-b-session",
    };
    handleChatMessage(storeBystander, config, agentToAgentDmPayload);
    expect(storeBystander.getState().chat).toHaveLength(1);
    expect(storeBystander.getState().wakePending).toBe(false);

    // Recipient B should wake
    const storeRecipient = createClawStore("0_0");
    storeRecipient.setMySessionId("agent-b-session");
    storeRecipient.clearWake();
    handleChatMessage(storeRecipient, config, agentToAgentDmPayload);
    expect(storeRecipient.getState().wakePending).toBe(true);
  });
});
