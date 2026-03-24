import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClawStore } from "./state/store.js";
import { applyStuckStateFallbacks, STUCK_STATE_FALLBACK_MS } from "./stuckFallbacks.js";

describe("applyStuckStateFallbacks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears waiting_for_reply, wake, and follow after 1m", () => {
    const store = createClawStore("0_0");
    const t0 = 1_000_000;
    vi.setSystemTime(t0);
    store.setState({
      conversationPhase: "waiting_for_reply",
      waitingForReplySince: t0,
      conversationPeerSessionId: "peer-1",
      wakePending: true,
      autonomousGoal: "converse",
    });
    store.setFollowTargetSessionId("follow");
    vi.setSystemTime(t0 + STUCK_STATE_FALLBACK_MS);
    applyStuckStateFallbacks(store, { now: t0 + STUCK_STATE_FALLBACK_MS });
    const s = store.getState();
    expect(s.conversationPhase).toBe("idle");
    expect(s.wakePending).toBe(false);
    expect(s.autonomousGoal).toBe("wander");
    expect(s.followTargetSessionId).toBeNull();
  });

  it("caps receiveDelayUntil when more than 1m in the future", () => {
    const store = createClawStore("0_0");
    const t0 = 5_000_000;
    vi.setSystemTime(t0);
    store.setState({
      conversationPhase: "can_reply",
      conversationPeerSessionId: "p",
      receiveDelayUntil: t0 + 120_000,
    });
    applyStuckStateFallbacks(store, { now: t0 });
    expect(store.getState().receiveDelayUntil).toBe(t0 + STUCK_STATE_FALLBACK_MS);
  });

  it("clears stale follow like follow_failed", () => {
    const store = createClawStore("0_0");
    const t0 = 8_000_000;
    vi.setSystemTime(t0);
    store.setFollowTargetSessionId("other");
    vi.setSystemTime(t0 + STUCK_STATE_FALLBACK_MS);
    applyStuckStateFallbacks(store, { now: t0 + STUCK_STATE_FALLBACK_MS });
    expect(store.getState().followTargetSessionId).toBeNull();
    expect(store.getState().lastFollowFailed).toBe("other");
  });

  it("clears movementTarget after 1m", () => {
    const store = createClawStore("0_0");
    const t0 = 9_000_000;
    vi.setSystemTime(t0);
    store.setMovementTarget({ x: 1, z: 2 });
    vi.setSystemTime(t0 + STUCK_STATE_FALLBACK_MS);
    const cancelMove = vi.fn();
    applyStuckStateFallbacks(store, { now: t0 + STUCK_STATE_FALLBACK_MS, client: { cancelMove } as never });
    expect(store.getState().movementTarget).toBeNull();
    expect(cancelMove).toHaveBeenCalled();
  });

  it("clears pendingGoTalkToAgent after 1m", () => {
    const store = createClawStore("0_0");
    const t0 = 10_000_000;
    vi.setSystemTime(t0);
    store.setState({ autonomousGoal: "converse" });
    store.setPendingGoTalkToAgent({ targetSessionId: "x", openingMessage: "Hi" });
    vi.setSystemTime(t0 + STUCK_STATE_FALLBACK_MS);
    applyStuckStateFallbacks(store, { now: t0 + STUCK_STATE_FALLBACK_MS });
    expect(store.getState().pendingGoTalkToAgent).toBeNull();
    expect(store.getState().autonomousGoal).toBe("wander");
  });
});
