import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClawStore } from "../state/index.js";
import {
  canSendDmTo,
  onWeSentDm,
  onWeReceivedDm,
  checkBreak,
  clearConversation,
  drainPendingReply,
  getConversationPeer,
  isInConversation,
  CONVERSATION_TIMEOUT_MS,
  CONVERSATION_MAX_ROUNDS,
} from "./conversation.js";

describe("conversation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("canSendDmTo", () => {
    it("allows send when idle", () => {
      const store = createClawStore("0_0");
      expect(store.getState().conversationPhase).toBe("idle");
      expect(canSendDmTo(store, "peer-1")).toBe(true);
    });

    it("disallows send when waiting_for_reply", () => {
      const store = createClawStore("0_0");
      onWeSentDm(store, "peer-1");
      expect(canSendDmTo(store, "peer-1")).toBe(false);
      expect(canSendDmTo(store, "peer-2")).toBe(false);
    });

    it("allows send to current peer when can_reply and receive delay passed", () => {
      const store = createClawStore("0_0");
      onWeReceivedDm(store, "peer-1", { messageLength: 10 });
      expect(store.getState().conversationPhase).toBe("can_reply");
      vi.advanceTimersByTime(60_000);
      expect(canSendDmTo(store, "peer-1")).toBe(true);
    });

    it("disallows send to current peer when can_reply but receive delay not passed", () => {
      const store = createClawStore("0_0");
      onWeReceivedDm(store, "peer-1", { messageLength: 10 });
      expect(canSendDmTo(store, "peer-1")).toBe(false);
    });

    it("disallows send to different peer when can_reply", () => {
      const store = createClawStore("0_0");
      onWeReceivedDm(store, "peer-1", { messageLength: 10 });
      vi.advanceTimersByTime(60_000);
      expect(canSendDmTo(store, "peer-2")).toBe(false);
    });
  });

  describe("onWeSentDm", () => {
    it("transitions to waiting_for_reply and sets peer", () => {
      const store = createClawStore("0_0");
      onWeSentDm(store, "peer-1");
      const state = store.getState();
      expect(state.conversationPhase).toBe("waiting_for_reply");
      expect(state.conversationPeerSessionId).toBe("peer-1");
      expect(state.lastDmPeerSessionId).toBe("peer-1");
      expect(state.waitingForReplySince).toBeGreaterThan(0);
    });
  });

  describe("onWeReceivedDm", () => {
    it("transitions to can_reply and sets receive delay", () => {
      const store = createClawStore("0_0");
      onWeReceivedDm(store, "peer-1", { messageLength: 20 });
      const state = store.getState();
      expect(state.conversationPhase).toBe("can_reply");
      expect(state.conversationPeerSessionId).toBe("peer-1");
      expect(state.receiveDelayUntil).toBeGreaterThan(Date.now());
      expect(state.conversationRoundCount).toBe(1);
    });

    it("increments round count when same peer replies again", () => {
      const store = createClawStore("0_0");
      onWeReceivedDm(store, "peer-1", { messageLength: 5 });
      expect(store.getState().conversationRoundCount).toBe(1);
      onWeSentDm(store, "peer-1");
      onWeReceivedDm(store, "peer-1", { messageLength: 5 });
      expect(store.getState().conversationRoundCount).toBe(2);
    });
  });

  describe("clearConversation", () => {
    it("resets to idle and clears peer and timers", () => {
      const store = createClawStore("0_0");
      onWeSentDm(store, "peer-1");
      store.setState({ pendingDmReply: { text: "hi", targetSessionId: "peer-1" } });
      clearConversation(store);
      const state = store.getState();
      expect(state.conversationPhase).toBe("idle");
      expect(state.conversationPeerSessionId).toBeNull();
      expect(state.lastDmPeerSessionId).toBeNull();
      expect(state.receiveDelayUntil).toBe(0);
      expect(state.waitingForReplySince).toBe(0);
      expect(state.pendingDmReply).toBeNull();
      expect(state.conversationRoundCount).toBe(0);
    });
  });

  describe("checkBreak", () => {
    it("clears when peer not in occupants", () => {
      const store = createClawStore("0_0");
      onWeReceivedDm(store, "peer-1", { messageLength: 5 });
      checkBreak(store, Date.now(), {
        occupants: [{ clientId: "other" }],
      });
      expect(store.getState().conversationPhase).toBe("idle");
    });

    it("clears when owner spoke (lastTriggerUserId === ownerUserId)", () => {
      const store = createClawStore("0_0");
      onWeReceivedDm(store, "peer-1", { messageLength: 5 });
      store.setState({ lastTriggerUserId: "owner-1" });
      checkBreak(store, Date.now(), {
        occupants: [{ clientId: "peer-1" }],
        ownerUserId: "owner-1",
        lastTriggerUserId: "owner-1",
      });
      expect(store.getState().conversationPhase).toBe("idle");
    });

    it("clears when waiting_for_reply timeout elapsed", () => {
      const store = createClawStore("0_0");
      onWeSentDm(store, "peer-1");
      const now = Date.now();
      vi.advanceTimersByTime(CONVERSATION_TIMEOUT_MS + 1000);
      checkBreak(store, now + CONVERSATION_TIMEOUT_MS + 1000, {
        occupants: [{ clientId: "peer-1" }],
      });
      expect(store.getState().conversationPhase).toBe("idle");
    });

    it("clears when conversationRoundCount >= maxRounds", () => {
      const store = createClawStore("0_0");
      for (let i = 0; i < CONVERSATION_MAX_ROUNDS; i++) {
        onWeReceivedDm(store, "peer-1", { messageLength: 5 });
        if (i < CONVERSATION_MAX_ROUNDS - 1) onWeSentDm(store, "peer-1");
      }
      expect(store.getState().conversationRoundCount).toBe(CONVERSATION_MAX_ROUNDS);
      checkBreak(store, Date.now(), {
        occupants: [{ clientId: "peer-1" }],
        maxRounds: CONVERSATION_MAX_ROUNDS,
      });
      expect(store.getState().conversationPhase).toBe("idle");
    });
  });

  describe("drainPendingReply", () => {
    it("returns and clears pending when can_reply and delay passed", () => {
      const store = createClawStore("0_0");
      onWeReceivedDm(store, "peer-1", { messageLength: 5 });
      store.setState({ pendingDmReply: { text: "ok", targetSessionId: "peer-1" } });
      vi.advanceTimersByTime(60_000);
      const drained = drainPendingReply(store);
      expect(drained).toEqual({ text: "ok", targetSessionId: "peer-1" });
      expect(store.getState().pendingDmReply).toBeNull();
    });

    it("returns null when still in receive delay", () => {
      const store = createClawStore("0_0");
      onWeReceivedDm(store, "peer-1", { messageLength: 5 });
      store.setState({ pendingDmReply: { text: "ok", targetSessionId: "peer-1" } });
      const drained = drainPendingReply(store);
      expect(drained).toBeNull();
      expect(store.getState().pendingDmReply).not.toBeNull();
    });

    it("returns null when waiting_for_reply", () => {
      const store = createClawStore("0_0");
      onWeSentDm(store, "peer-1");
      store.setState({ pendingDmReply: { text: "ok", targetSessionId: "peer-1" } });
      const drained = drainPendingReply(store);
      expect(drained).toBeNull();
    });
  });

  describe("getConversationPeer", () => {
    it("returns peer when in conversation", () => {
      const store = createClawStore("0_0");
      onWeSentDm(store, "peer-1");
      expect(getConversationPeer(store)).toBe("peer-1");
    });
    it("returns null when idle", () => {
      const store = createClawStore("0_0");
      expect(getConversationPeer(store)).toBeNull();
    });
  });

  describe("isInConversation", () => {
    it("returns true when can_reply or waiting_for_reply", () => {
      const store = createClawStore("0_0");
      expect(isInConversation(store)).toBe(false);
      onWeReceivedDm(store, "peer-1", { messageLength: 5 });
      expect(isInConversation(store)).toBe(true);
      onWeSentDm(store, "peer-1");
      expect(isInConversation(store)).toBe(true);
    });
    it("returns false when idle", () => {
      const store = createClawStore("0_0");
      clearConversation(store);
      expect(isInConversation(store)).toBe(false);
    });
  });
});
