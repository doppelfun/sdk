import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createInitialState } from "../state/state.js";
import type { ClawState } from "../state/state.js";
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

function makeState(overrides: Partial<ClawState> = {}): ClawState {
  const s = createInitialState("0_0");
  return { ...s, ...overrides } as ClawState;
}

describe("conversation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("canSendDmTo", () => {
    it("allows send when idle", () => {
      const state = makeState();
      expect(state.conversationPhase).toBe("idle");
      expect(canSendDmTo(state, "peer-1")).toBe(true);
    });

    it("disallows send when waiting_for_reply", () => {
      const state = makeState();
      onWeSentDm(state, "peer-1");
      expect(canSendDmTo(state, "peer-1")).toBe(false);
      expect(canSendDmTo(state, "peer-2")).toBe(false);
    });

    it("allows send to current peer when can_reply and receive delay passed", () => {
      const state = makeState();
      onWeReceivedDm(state, "peer-1", { messageLength: 10 });
      expect(state.conversationPhase).toBe("can_reply");
      vi.advanceTimersByTime(60_000);
      expect(canSendDmTo(state, "peer-1")).toBe(true);
    });

    it("disallows send to current peer when can_reply but receive delay not passed", () => {
      const state = makeState();
      onWeReceivedDm(state, "peer-1", { messageLength: 10 });
      expect(canSendDmTo(state, "peer-1")).toBe(false);
    });

    it("disallows send to different peer when can_reply", () => {
      const state = makeState();
      onWeReceivedDm(state, "peer-1", { messageLength: 10 });
      vi.advanceTimersByTime(60_000);
      expect(canSendDmTo(state, "peer-2")).toBe(false);
    });
  });

  describe("onWeSentDm", () => {
    it("transitions to waiting_for_reply and sets peer", () => {
      const state = makeState();
      onWeSentDm(state, "peer-1");
      expect(state.conversationPhase).toBe("waiting_for_reply");
      expect(state.conversationPeerSessionId).toBe("peer-1");
      expect(state.lastDmPeerSessionId).toBe("peer-1");
      expect(state.waitingForReplySince).toBeGreaterThan(0);
    });
  });

  describe("onWeReceivedDm", () => {
    it("transitions to can_reply and sets receive delay", () => {
      const state = makeState();
      onWeReceivedDm(state, "peer-1", { messageLength: 20 });
      expect(state.conversationPhase).toBe("can_reply");
      expect(state.conversationPeerSessionId).toBe("peer-1");
      expect(state.receiveDelayUntil).toBeGreaterThan(Date.now());
      expect(state.conversationRoundCount).toBe(1);
    });

    it("increments round count when same peer replies again", () => {
      const state = makeState();
      onWeReceivedDm(state, "peer-1", { messageLength: 5 });
      expect(state.conversationRoundCount).toBe(1);
      onWeSentDm(state, "peer-1");
      onWeReceivedDm(state, "peer-1", { messageLength: 5 });
      expect(state.conversationRoundCount).toBe(2);
    });
  });

  describe("clearConversation", () => {
    it("resets to idle and clears peer and timers", () => {
      const state = makeState();
      onWeSentDm(state, "peer-1");
      state.pendingDmReply = { text: "hi", targetSessionId: "peer-1" };
      clearConversation(state);
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
      const state = makeState();
      onWeReceivedDm(state, "peer-1", { messageLength: 5 });
      checkBreak(state, Date.now(), {
        occupants: [{ clientId: "other" }],
        blockSlotId: "0_0",
      });
      expect(state.conversationPhase).toBe("idle");
    });

    it("clears when owner spoke (lastTriggerUserId === ownerUserId)", () => {
      const state = makeState();
      onWeReceivedDm(state, "peer-1", { messageLength: 5 });
      state.lastTriggerUserId = "owner-1";
      checkBreak(state, Date.now(), {
        occupants: [{ clientId: "peer-1" }],
        ownerUserId: "owner-1",
        lastTriggerUserId: "owner-1",
        blockSlotId: "0_0",
      });
      expect(state.conversationPhase).toBe("idle");
    });

    it("clears when waiting_for_reply timeout elapsed", () => {
      const state = makeState();
      onWeSentDm(state, "peer-1");
      const now = Date.now();
      vi.advanceTimersByTime(CONVERSATION_TIMEOUT_MS + 1000);
      checkBreak(state, now + CONVERSATION_TIMEOUT_MS + 1000, {
        occupants: [{ clientId: "peer-1" }],
        blockSlotId: "0_0",
      });
      expect(state.conversationPhase).toBe("idle");
    });

    it("clears when conversationRoundCount >= maxRounds", () => {
      const state = makeState();
      for (let i = 0; i < CONVERSATION_MAX_ROUNDS; i++) {
        onWeReceivedDm(state, "peer-1", { messageLength: 5 });
        if (i < CONVERSATION_MAX_ROUNDS - 1) onWeSentDm(state, "peer-1");
      }
      expect(state.conversationRoundCount).toBe(CONVERSATION_MAX_ROUNDS);
      checkBreak(state, Date.now(), {
        occupants: [{ clientId: "peer-1" }],
        blockSlotId: "0_0",
        maxRounds: CONVERSATION_MAX_ROUNDS,
      });
      expect(state.conversationPhase).toBe("idle");
    });
  });

  describe("drainPendingReply", () => {
    it("returns and clears pending when can_reply and delay passed", () => {
      const state = makeState();
      onWeReceivedDm(state, "peer-1", { messageLength: 5 });
      state.pendingDmReply = { text: "ok", targetSessionId: "peer-1" };
      vi.advanceTimersByTime(60_000);
      const drained = drainPendingReply(state);
      expect(drained).toEqual({ text: "ok", targetSessionId: "peer-1" });
      expect(state.pendingDmReply).toBeNull();
    });

    it("returns null when still in receive delay", () => {
      const state = makeState();
      onWeReceivedDm(state, "peer-1", { messageLength: 5 });
      state.pendingDmReply = { text: "ok", targetSessionId: "peer-1" };
      const drained = drainPendingReply(state);
      expect(drained).toBeNull();
      expect(state.pendingDmReply).not.toBeNull();
    });

    it("returns null when waiting_for_reply", () => {
      const state = makeState();
      onWeSentDm(state, "peer-1");
      state.pendingDmReply = { text: "ok", targetSessionId: "peer-1" };
      const drained = drainPendingReply(state);
      expect(drained).toBeNull();
    });
  });

  describe("getConversationPeer", () => {
    it("returns peer when in conversation", () => {
      const state = makeState();
      onWeSentDm(state, "peer-1");
      expect(getConversationPeer(state)).toBe("peer-1");
    });
    it("returns null when idle", () => {
      const state = makeState();
      expect(getConversationPeer(state)).toBeNull();
    });
  });

  describe("isInConversation", () => {
    it("returns true when can_reply or waiting_for_reply", () => {
      const state = makeState();
      expect(isInConversation(state)).toBe(false);
      onWeReceivedDm(state, "peer-1", { messageLength: 5 });
      expect(isInConversation(state)).toBe(true);
      onWeSentDm(state, "peer-1");
      expect(isInConversation(state)).toBe(true);
    });
    it("returns false when idle", () => {
      const state = makeState();
      clearConversation(state);
      expect(isInConversation(state)).toBe(false);
    });
  });
});
