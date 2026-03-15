import { describe, it, expect } from "vitest";
import { createClawStore } from "../../state/index.js";
import { evaluateReplyAction } from "./evaluateReply.js";

function getState(overrides: Record<string, unknown> = {}) {
  const store = createClawStore("0_0");
  store.setState(overrides as never);
  return store.getState();
}

describe("evaluateReplyAction", () => {
  it("returns none when no pending flags", () => {
    const state = getState({ dmReplyPending: false, errorReplyPending: false });
    const action = evaluateReplyAction(state, { ok: true, hadToolCalls: false });
    expect(action.action).toBe("none");
  });

  it("returns send (dm fallback) when dmReplyPending, no tool calls, has lastDmPeerSessionId", () => {
    const state = getState({
      dmReplyPending: true,
      errorReplyPending: false,
      lastDmPeerSessionId: "peer-1",
      lastTickSentChat: false,
    });
    const action = evaluateReplyAction(state, { ok: true, hadToolCalls: false });
    expect(action.action).toBe("send");
    expect(action.targetSessionId).toBe("peer-1");
    expect(action.text).toBe("Hey — I'm here.");
    expect(action.logLabel).toContain("dm fallback");
  });

  it("uses replyText for dm fallback when provided", () => {
    const state = getState({
      dmReplyPending: true,
      lastDmPeerSessionId: "peer-1",
    });
    const action = evaluateReplyAction(state, {
      ok: true,
      hadToolCalls: false,
      replyText: "Sure, one sec!",
    });
    expect(action.action).toBe("send");
    expect(action.text).toBe("Sure, one sec!");
  });

  it("returns send (dm ack) when dmReplyPending, hadToolCalls, and !lastTickSentChat", () => {
    const state = getState({
      dmReplyPending: true,
      lastDmPeerSessionId: "peer-1",
      lastTickSentChat: false,
    });
    const action = evaluateReplyAction(state, { ok: true, hadToolCalls: true });
    expect(action.action).toBe("send");
    expect(action.targetSessionId).toBe("peer-1");
    expect(action.text).toBe("On my way!");
    expect(action.logLabel).toContain("dm ack");
  });

  it("returns send (error fallback) when errorReplyPending and no tool calls", () => {
    const state = getState({
      dmReplyPending: false,
      errorReplyPending: true,
      lastDmPeerSessionId: null,
    });
    const action = evaluateReplyAction(state, { ok: true, hadToolCalls: false });
    expect(action.action).toBe("send");
    expect(action.targetSessionId).toBeNull();
    expect(action.text).toContain("Something went wrong");
    expect(action.logLabel).toContain("error-reply");
  });

  it("prioritizes dm fallback over error when both pending and no tool calls", () => {
    const state = getState({
      dmReplyPending: true,
      errorReplyPending: true,
      lastDmPeerSessionId: "peer-1",
    });
    const action = evaluateReplyAction(state, { ok: true, hadToolCalls: false });
    expect(action.action).toBe("send");
    expect(action.logLabel).toContain("dm fallback");
  });

  it("replaces narration-like replyText with default (dm fallback)", () => {
    const state = getState({
      dmReplyPending: true,
      lastDmPeerSessionId: "peer-1",
    });
    const action = evaluateReplyAction(state, {
      ok: true,
      hadToolCalls: false,
      replyText: "OK! I've sent a friendly message and waved hello. I'm feeling very happy today!",
    });
    expect(action.action).toBe("send");
    expect(action.text).toBe("Hey — I'm here.");
  });

  it("replaces narration-like replyText with default (dm ack after tools)", () => {
    const state = getState({
      dmReplyPending: true,
      lastDmPeerSessionId: "peer-1",
      lastTickSentChat: false,
    });
    const action = evaluateReplyAction(state, {
      ok: true,
      hadToolCalls: true,
      replyText: "OK! I've replied to the DM and waved hello. I'm feeling happy and ready to continue!",
    });
    expect(action.action).toBe("send");
    expect(action.text).toBe("On my way!");
  });
});
