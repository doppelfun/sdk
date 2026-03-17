/**
 * Mistreevous agent object: actions and conditions for the behaviour tree.
 * Built from store, config, and optional client + runObedient/runAutonomous.
 * @see docs/PLAN-AGENT-WAKE-DRIVEN.md §11
 */

import { State } from "mistreevous";
import type { ClawStore } from "../state/index.js";
import type { ClawConfig } from "../config/index.js";
import { hasEnoughCredits, MIN_BALANCE_THRESHOLD } from "../credits/index.js";
import { isOwnerNearby } from "../../util/position.js";
import { clawLog } from "../../util/log.js";

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
};

/**
 * Build the Mistreevous agent object for BehaviourTree(definition, agent).
 * Keys match tree node names (ExecuteMovementAndDrain, HasOwnerWake, RunObedientAgent, etc.).
 * Condition methods return boolean; action methods return State or Promise<State>.
 *
 * @param ctx - Store, config, and optional callbacks for movement, obedient, autonomous
 * @returns Agent object keyed by action/condition names
 */
export function createTreeAgent(ctx: TreeAgentContext): Record<string, () => State | boolean | Promise<State>> {
  const { store, config, runObedientAgent, runAutonomousAgent, executeMovementAndDrain, tryMoveToNearestOccupant } = ctx;

  return {
    ExecuteMovementAndDrain(): State {
      if (executeMovementAndDrain) executeMovementAndDrain();
      return State.SUCCEEDED;
    },

    HasOwnerWake(): boolean {
      const s = store.getState();
      const isOwner = config.ownerUserId != null && s.lastTriggerUserId === config.ownerUserId;
      const hasScheduledTask = s.pendingScheduledTask != null;
      const hasDmToReply = s.lastDmPeerSessionId != null;
      return s.wakePending && (isOwner || hasScheduledTask || hasDmToReply);
    },

    HasEnoughCredits(): boolean {
      return hasEnoughCredits(store, config);
    },

    InsufficientCredits(): boolean {
      const s = store.getState();
      if (!s.wakePending) return false;
      const isOwner = config.ownerUserId != null && s.lastTriggerUserId === config.ownerUserId;
      const hasScheduledTask = s.pendingScheduledTask != null;
      const isAutonomous = s.lastTriggerUserId !== config.ownerUserId && !hasScheduledTask;
      if (!isOwner && !hasScheduledTask && !isAutonomous) return false;
      return !hasEnoughCredits(store, config);
    },

    ClearWakeInsufficientCredits(): State {
      const state = store.getState();
      clawLog(
        "credits: blocking run — insufficient credits (cachedBalance=%s, threshold=%s)",
        state.cachedBalance.toFixed(2),
        MIN_BALANCE_THRESHOLD.toFixed(2)
      );
      store.clearWake();
      store.clearPendingScheduledTask();
      return State.SUCCEEDED;
    },

    /** Consume wake and scheduled task first so the next tree step doesn't re-enter. */
    async RunObedientAgent(): Promise<State> {
      clawLog("tree: RunObedientAgent");
      store.clearWake();
      store.clearPendingScheduledTask();
      if (runObedientAgent) await runObedientAgent();
      return State.SUCCEEDED;
    },

    HasAutonomousWake(): boolean {
      const s = store.getState();
      if (!s.wakePending || s.pendingScheduledTask != null) return false;
      return s.lastTriggerUserId !== config.ownerUserId;
    },

    /** True when we should run the autonomous LLM: real DM (lastTriggerUserId set) or cooldown elapsed. Prevents LLM spam in soul mode. */
    CanRunAutonomousLlm(): boolean {
      const s = store.getState();
      if (s.lastTriggerUserId != null) return true;
      const elapsed = Date.now() - s.lastAutonomousRunAt;
      return elapsed >= config.autonomousLlmCooldownMs;
    },

    /** Tree-driven move (no LLM). Used when autonomous wake but cooldown not elapsed. */
    TryMoveToNearestOccupant(): State {
      if (tryMoveToNearestOccupant) tryMoveToNearestOccupant();
      return State.SUCCEEDED;
    },

    /** Consume wake and owner messages first; then run LLM. Clear owner so autonomous doesn't re-run last command. */
    async RunAutonomousAgent(): Promise<State> {
      clawLog("tree: RunAutonomousAgent");
      store.clearWake();
      store.clearOwnerMessages();
      if (runAutonomousAgent) await runAutonomousAgent();
      store.setLastAutonomousRunAt(Date.now());
      return State.SUCCEEDED;
    },

    TimeForAutonomousWake(): boolean {
      const s = store.getState();
      if (s.wakePending) return false;
      if (!config.ownerUserId || config.autonomousSoulTickMs <= 0) return false;
      const ownerAway = s.myPosition != null && !isOwnerNearby(s.occupants, s.myPosition, config.ownerUserId, config.ownerNearbyRadiusM);
      if (!ownerAway) return false;
      const elapsed = Date.now() - s.lastAutonomousRunAt;
      return elapsed >= config.autonomousSoulTickMs;
    },

    RequestAutonomousWake(): State {
      store.setWakePending(true);
      // So the next tick HasOwnerWake is false and HasAutonomousWake is true (selector runs autonomous branch).
      store.setLastTriggerUserId(null);
      return State.SUCCEEDED;
    },

    ClearWakeIdle(): State {
      store.clearWake();
      return State.SUCCEEDED;
    },
  };
}

