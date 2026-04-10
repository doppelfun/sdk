/**
 * Mistreevous agent object: actions and conditions for the behaviour tree.
 * Built from store, config, and optional callbacks (movement, obedient, converse).
 *
 * Structure:
 * - Wake/credits: HasOwnerWake, HasEnoughCredits, InsufficientCredits, ClearWakeInsufficientCredits (+ optional user chat)
 * - Obedient: RunObedientAgent (owner or scheduled task)
 * - Autonomous: OwnerAway, OwnerAwayOrInConversation, InConversation, WasConverseButNowIdle, HasApproachGoal, ShouldSeekSocialTarget,
 *   RunConverseAgent, ExitConversationToWander, ContinueApproach, SeekSocialTarget, SetWanderGoal, TryMoveToNearestOccupant
 * - Wake timing: TimeForAutonomousWake, RequestAutonomousWake, ClearWakeIdle
 *
 * @see docs/PLAN-AGENT-WAKE-DRIVEN.md §11
 */

import { State } from "mistreevous";
import type { ClawStore } from "../state/index.js";
import type { ClawConfig } from "../config/index.js";
import type { ClawState } from "../state/index.js";
import { hasEnoughCredits, MIN_BALANCE_THRESHOLD } from "../credits/index.js";
import { isOwnerNearby } from "../../util/position.js";
import { clawLog } from "../../util/log.js";
import { setCurrentActionForNode, setLastCompletedActionForNode } from "./mapping.js";
import { hubCompanionActivityActive } from "../hubActivity.js";

export type TreeAgentContext = {
  store: ClawStore;
  config: ClawConfig;
  /** Optional: run one Obedient tick (async). When absent, RunObedientAgent is a no-op stub. */
  runObedientAgent?: () => Promise<void>;
  /** Optional: run one Autonomous tick (async). When absent, RunAutonomousAgent is a no-op stub. */
  runAutonomousAgent?: () => Promise<void>;
  /** Optional: movement + drain tick. When absent, ExecuteMovementAndDrain is a no-op. */
  executeMovementAndDrain?: () => void;
  /** Optional: move to nearest occupant (no LLM). When absent, TryMoveToNearestOccupant no-ops. */
  tryMoveToNearestOccupant?: () => void;
  /** Optional: decision-layer seek social target; sets approach goal and moveTo. Autonomous only. */
  seekSocialTarget?: () => void;
  /** Optional: run one Converse tick (chat-only LLM). When absent, RunConverseAgent no-ops. */
  runConverseAgent?: () => Promise<void>;
  /**
   * Optional: notify user when credits block a wake (e.g. send DM). Invoked from ClearWakeInsufficientCredits before clearing wake state.
   */
  onInsufficientCreditsBlocked?: () => void;
};

/** True when wake was triggered by owner (DM) or by a scheduled task. Used to gate Obedient branch and credit clearing. */
function isOwnerTrigger(s: ClawState, config: ClawConfig): boolean {
  const isOwner = config.ownerUserId != null && s.lastTriggerUserId === config.ownerUserId;
  const hasScheduledTask = s.pendingScheduledTask != null;
  return isOwner || hasScheduledTask;
}

/**
 * Build the Mistreevous agent object for BehaviourTree(definition, agent).
 * Keys match tree node names (ExecuteMovementAndDrain, HasOwnerWake, RunObedientAgent, etc.).
 * Condition methods return boolean; action methods return State or Promise<State>.
 *
 * @param ctx - Store, config, and optional callbacks for movement, obedient, converse
 * @returns Agent object keyed by action/condition names
 */
export function createTreeAgent(ctx: TreeAgentContext): Record<string, () => State | boolean | Promise<State>> {
  const {
    store,
    config,
    runObedientAgent,
    runAutonomousAgent,
    executeMovementAndDrain,
    tryMoveToNearestOccupant,
    seekSocialTarget,
    runConverseAgent,
    onInsufficientCreditsBlocked,
  } = ctx;

  return {
    // --- Movement (every tick) ---
    ExecuteMovementAndDrain(): State {
      setCurrentActionForNode(store, "ExecuteMovementAndDrain");
      if (executeMovementAndDrain) executeMovementAndDrain();
      setLastCompletedActionForNode(store, "ExecuteMovementAndDrain");
      return State.SUCCEEDED;
    },

    // --- Wake & credits (selector gates) ---
    /** True only when wake was triggered by the owner (DM) or a scheduled task. Guest DMs must not run Obedient. */
    HasOwnerWake(): boolean {
      const s = store.getState();
      return s.wakePending && isOwnerTrigger(s, config);
    },

    HasEnoughCredits(): boolean {
      return hasEnoughCredits(store, config);
    },

    /** True when current wake branch would run but credits are insufficient (owner, scheduled, or autonomous). */
    InsufficientCredits(): boolean {
      const s = store.getState();
      if (!s.wakePending) return false;
      const isAutonomous = s.lastTriggerUserId !== config.ownerUserId && !s.pendingScheduledTask;
      if (!isOwnerTrigger(s, config) && !isAutonomous) return false;
      return !hasEnoughCredits(store, config);
    },

    ClearWakeInsufficientCredits(): State {
      setCurrentActionForNode(store, "ClearWakeInsufficientCredits");
      const state = store.getState();
      clawLog(
        "credits: blocking run — insufficient credits (cachedBalance=%s, threshold=%s)",
        state.cachedBalance.toFixed(2),
        MIN_BALANCE_THRESHOLD.toFixed(2)
      );
      onInsufficientCreditsBlocked?.();
      store.clearWake();
      store.clearPendingScheduledTask();
      setLastCompletedActionForNode(store, "ClearWakeInsufficientCredits");
      return State.SUCCEEDED;
    },

    /** Consume wake and scheduled task, clear any autonomous conversation state (owner takes over), then run obedient. */
    async RunObedientAgent(): Promise<State> {
      setCurrentActionForNode(store, "RunObedientAgent");
      clawLog("tree: RunObedientAgent");
      store.clearWake();
      store.clearPendingScheduledTask();
      // Clear conversation state so agent is no longer "in conversation" with the other person; next tick won't resume it.
      store.setConversationPhase("idle");
      store.setConversationPeerSessionId(null);
      store.setAutonomousGoal("wander");
      store.setAutonomousTargetSessionId(null);
      store.setPendingGoTalkToAgent(null);
      store.setFollowTargetSessionId(null);
      const now = Date.now();
      store.setSocialSeekCooldownUntil(now + 5_000);
      if (runObedientAgent) await runObedientAgent();
      setLastCompletedActionForNode(store, "RunObedientAgent");
      return State.SUCCEEDED;
    },

    // --- Obedient (owner or scheduled task) ---
    // RunObedientAgent above consumes wake and runs LLM.

    // --- Autonomous wake gate ---
    HasAutonomousWake(): boolean {
      if (config.agentType === "builder") return false;
      const s = store.getState();
      if (!s.wakePending || s.pendingScheduledTask != null) return false;
      return s.lastTriggerUserId !== config.ownerUserId;
    },

    /** True when owner is not nearby (or we have no owner). Prevents autonomous mode when owner is in range. */
    OwnerAway(): boolean {
      const s = store.getState();
      if (!config.ownerUserId) return true;
      if (!s.myPosition) return true;
      return !isOwnerNearby(s.occupants, s.myPosition, config.ownerUserId, config.ownerNearbyRadiusM);
    },

    /**
     * True when owner is away OR we're already in a peer conversation OR a companion skill run is active.
     * Without the skill-run case, an observing owner in-world is "nearby" every tick → the autonomous
     * sequence fails → `ClearWakeIdle` clears the wake from hub activity, and rapport runs never seek/DM others.
     */
    OwnerAwayOrInConversation(): boolean {
      const s = store.getState();
      if (s.conversationPhase !== "idle") return true;
      if (config.agentType === "companion" && hubCompanionActivityActive(store)) return true;
      if (!config.ownerUserId) return true;
      if (!s.myPosition) return true;
      return !isOwnerNearby(s.occupants, s.myPosition, config.ownerUserId, config.ownerNearbyRadiusM);
    },

    // --- Conversation / social (autonomous decision layer) ---
    /** True when not in a conversation (phase is idle). Gates movement so we don't move toward someone while talking. */
    NotInConversation(): boolean {
      return store.getState().conversationPhase === "idle";
    },

    /** True when in an active conversation (phase not idle). */
    InConversation(): boolean {
      return store.getState().conversationPhase !== "idle";
    },

    /** True when we can send a reply (phase can_reply). Gates RunConverseAgent so we only run LLM when we have received a message. */
    CanReplyInConversation(): boolean {
      return store.getState().conversationPhase === "can_reply";
    },

    /** True when we sent and are waiting for peer reply (phase waiting_for_reply). Run ContinueWaiting to avoid spinning LLM. */
    WaitingForReply(): boolean {
      return store.getState().conversationPhase === "waiting_for_reply";
    },

    /** True when we were in converse goal but conversation just ended (phase idle). Transition to wander. */
    WasConverseButNowIdle(): boolean {
      const s = store.getState();
      return s.autonomousGoal === "converse" && s.conversationPhase === "idle";
    },

    /** True when decision layer set approach goal and we have a target; movement handles the rest. */
    HasApproachGoal(): boolean {
      const s = store.getState();
      return s.autonomousGoal === "approach" && s.autonomousTargetSessionId != null;
    },

    /** True when we may look for a new social target (wander/idle, not in conversation, cooldown elapsed, not already moving). */
    ShouldSeekSocialTarget(): boolean {
      const s = store.getState();
      if (config.agentType === "companion") {
        if (s.hubCoarseActivity === "explore" || s.hubCoarseActivity === "training") return false;
      }
      if (s.autonomousGoal === "approach" || s.autonomousGoal === "converse") return false;
      if (s.conversationPhase !== "idle") return false;
      if (Date.now() < s.socialSeekCooldownUntil) return false;
      if (s.movementTarget != null || s.followTargetSessionId != null) return false;
      const conversationSeek =
        config.agentType === "companion" &&
        s.hubCoarseActivity === "conversation" &&
        hubCompanionActivityActive(store);
      if (!conversationSeek && Date.now() < s.nextAutonomousMoveAt) return false;
      const others = s.occupants.filter(
        (o) => o.clientId !== s.mySessionId && o.position != null && o.type !== "observer"
      );
      return others.length > 0;
    },

    // --- Autonomous actions (movement and Converse) ---
    /** Tree-driven move (no LLM). Used when autonomous goal is wander. */
    TryMoveToNearestOccupant(): State {
      setCurrentActionForNode(store, "TryMoveToNearestOccupant");
      if (tryMoveToNearestOccupant) tryMoveToNearestOccupant();
      setLastCompletedActionForNode(store, "TryMoveToNearestOccupant");
      return State.SUCCEEDED;
    },

    /** Decision layer: pick best social target, set approach goal, start moveTo. */
    SeekSocialTarget(): State {
      setCurrentActionForNode(store, "SeekSocialTarget");
      if (seekSocialTarget) seekSocialTarget();
      setLastCompletedActionForNode(store, "SeekSocialTarget");
      return State.SUCCEEDED;
    },

    /** Movement is handling approach; no-op. */
    ContinueApproach(): State {
      setCurrentActionForNode(store, "ContinueApproach");
      setLastCompletedActionForNode(store, "ContinueApproach");
      return State.SUCCEEDED;
    },

    /** In conversation but waiting for peer reply; no-op so we don't run LLM or wander. */
    ContinueWaiting(): State {
      setCurrentActionForNode(store, "ContinueWaiting");
      setLastCompletedActionForNode(store, "ContinueWaiting");
      return State.SUCCEEDED;
    },

    /** Conversation ended; set goal to wander, clear target, set cooldown. */
    ExitConversationToWander(): State {
      setCurrentActionForNode(store, "ExitConversationToWander");
      const s = store.getState();
      const peer = s.conversationPeerSessionId ?? s.autonomousTargetSessionId;
      store.setAutonomousGoal("wander");
      store.setAutonomousTargetSessionId(null);
      if (peer) store.setSocialSeekCooldownUntil(Date.now() + 15_000);
      setLastCompletedActionForNode(store, "ExitConversationToWander");
      return State.SUCCEEDED;
    },

    /** Set decision-layer goal to wander so we don't immediately seek again. */
    SetWanderGoal(): State {
      setCurrentActionForNode(store, "SetWanderGoal");
      store.setAutonomousGoal("wander");
      setLastCompletedActionForNode(store, "SetWanderGoal");
      return State.SUCCEEDED;
    },

    /** Run one Converse tick (chat-only LLM). */
    async RunConverseAgent(): Promise<State> {
      setCurrentActionForNode(store, "RunConverseAgent");
      clawLog("tree: RunConverseAgent");
      store.clearWake();
      if (runConverseAgent) await runConverseAgent();
      store.setLastAutonomousRunAt(Date.now());
      setLastCompletedActionForNode(store, "RunConverseAgent");
      return State.SUCCEEDED;
    },

    // --- Wake timing (soul tick) ---
    /** True when enough time since last owner conversation and since last autonomous run → request autonomous wake. */
    TimeForAutonomousWake(): boolean {
      const s = store.getState();
      if (s.wakePending) return false;
      if (config.agentType === "builder") return false;
      if (config.agentType === "companion") {
        if (!hubCompanionActivityActive(store)) return false;
      }
      if (!config.ownerUserId || config.autonomousSoulTickMs <= 0) return false;
      const ownerAway = s.myPosition != null && !isOwnerNearby(s.occupants, s.myPosition, config.ownerUserId, config.ownerNearbyRadiusM);
      if (!ownerAway) return false;
      const AUTONOMOUS_WAKE_MIN_AFTER_OWNER_MS = 60_000;
      if (s.lastOwnerConversationAt > 0 && Date.now() - s.lastOwnerConversationAt < AUTONOMOUS_WAKE_MIN_AFTER_OWNER_MS) return false;
      const elapsed = Date.now() - s.lastAutonomousRunAt;
      return elapsed >= config.autonomousSoulTickMs;
    },

    RequestAutonomousWake(): State {
      setCurrentActionForNode(store, "RequestAutonomousWake");
      store.setWakePending(true);
      // So the next tick HasOwnerWake is false and HasAutonomousWake is true (selector runs autonomous branch).
      store.setLastTriggerUserId(null);
      setLastCompletedActionForNode(store, "RequestAutonomousWake");
      return State.SUCCEEDED;
    },

    ClearWakeIdle(): State {
      setCurrentActionForNode(store, "ClearWakeIdle");
      store.clearWake();
      setLastCompletedActionForNode(store, "ClearWakeIdle");
      return State.SUCCEEDED;
    },
  };
}

