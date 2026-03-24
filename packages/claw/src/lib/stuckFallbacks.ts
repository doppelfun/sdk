/**
 * Break out of indefinite waits: ghosted DMs, missing engine events, extreme receive delays.
 * Invoked at the start of each movement driver tick (50ms) so recovery is timely.
 */
import type { DoppelClient } from "@doppelfun/sdk";
import { clearConversation } from "./conversation.js";
import type { ClawStore } from "./state/index.js";
import { clawLog } from "../util/log.js";

/** Max time (ms) before we force-reset stuck conversation / movement / follow state. */
export const STUCK_STATE_FALLBACK_MS = 60_000;

export type ApplyStuckFallbacksOptions = {
  now?: number;
  client?: DoppelClient | null;
};

/**
 * Apply 1-minute fallbacks for states that could otherwise wait forever.
 * Safe to call every movement tick; no-ops when nothing is stale.
 */
export function applyStuckStateFallbacks(store: ClawStore, options?: ApplyStuckFallbacksOptions): void {
  const now = options?.now ?? Date.now();
  const client = options?.client;

  let s = store.getState();

  if (
    s.conversationPhase === "waiting_for_reply" &&
    s.waitingForReplySince > 0 &&
    now - s.waitingForReplySince >= STUCK_STATE_FALLBACK_MS
  ) {
    clawLog("stuck fallback: waiting_for_reply timeout — clearing conversation and wake");
    clearConversation(store);
    store.clearWake();
    if (s.autonomousGoal === "converse" || s.autonomousGoal === "approach") {
      store.setAutonomousGoal("wander");
      store.setAutonomousTargetSessionId(null);
    }
    store.setFollowTargetSessionId(null);
    client?.cancelApproach?.();
    s = store.getState();
  }

  s = store.getState();
  if (s.conversationPhase === "can_reply" && s.receiveDelayUntil > now + STUCK_STATE_FALLBACK_MS) {
    clawLog("stuck fallback: capping receiveDelayUntil to 1m from now");
    store.setReceiveDelayUntil(now + STUCK_STATE_FALLBACK_MS);
  }

  s = store.getState();
  if (
    s.followTargetSessionId &&
    s.followStartedAt > 0 &&
    now - s.followStartedAt >= STUCK_STATE_FALLBACK_MS
  ) {
    const tid = s.followTargetSessionId;
    clawLog("stuck fallback: follow timeout —", tid);
    store.setLastFollowFailed(tid);
    if (s.autonomousGoal === "approach" && s.autonomousTargetSessionId === tid) {
      store.setAutonomousGoal("wander");
      store.setAutonomousTargetSessionId(null);
    }
    client?.cancelApproach?.();
  }

  s = store.getState();
  if (
    s.movementTarget &&
    s.movementTargetSetAt > 0 &&
    now - s.movementTargetSetAt >= STUCK_STATE_FALLBACK_MS
  ) {
    clawLog("stuck fallback: movementTarget timeout — clearing target");
    store.setMovementTarget(null);
    store.setLastMoveToFailed(null);
    store.setNextWanderDestinationAt(now + 2000);
    store.setNextAutonomousMoveAt(now + 2000);
    client?.cancelMove?.();
  }

  s = store.getState();
  if (
    s.pendingGoTalkToAgent &&
    s.pendingGoTalkSince > 0 &&
    now - s.pendingGoTalkSince >= STUCK_STATE_FALLBACK_MS
  ) {
    clawLog("stuck fallback: pendingGoTalkToAgent timeout — clearing");
    store.setPendingGoTalkToAgent(null);
    if (s.autonomousGoal === "approach" || s.autonomousGoal === "converse") {
      store.setAutonomousGoal("wander");
      store.setAutonomousTargetSessionId(null);
    }
    store.setSocialSeekCooldownUntil(now + 5000);
  }
}
