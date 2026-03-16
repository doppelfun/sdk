/**
 * Mistreevous agent object: actions and conditions for the behaviour tree.
 * Built from store, config, and optional client + runObedient/runAutonomous.
 * @see docs/PLAN-AGENT-WAKE-DRIVEN.md §11
 */

import { State } from "mistreevous";
import type { ClawStore } from "../state/index.js";
import type { ClawConfig } from "../config/index.js";
import { hasEnoughCredits } from "../credits/index.js";
import { clawLog } from "../log.js";

export type TreeAgentContext = {
  store: ClawStore;
  config: ClawConfig;
  /** Optional: run one Obedient tick (async). When absent, RunObedientAgent is a no-op stub. */
  runObedientAgent?: () => Promise<void>;
  /** Optional: run one Autonomous tick (async). When absent, RunAutonomousAgent is a no-op stub. */
  runAutonomousAgent?: () => Promise<void>;
  /** Optional: movement + drain tick. When absent, ExecuteMovementAndDrain is a no-op. */
  executeMovementAndDrain?: () => void;
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
  const { store, config, runObedientAgent, runAutonomousAgent, executeMovementAndDrain } = ctx;

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
      store.clearWake();
      store.clearPendingScheduledTask();
      return State.SUCCEEDED;
    },

    async RunObedientAgent(): Promise<State> {
      clawLog("tree: RunObedientAgent");
      if (runObedientAgent) await runObedientAgent();
      store.clearWake();
      store.clearPendingScheduledTask();
      return State.SUCCEEDED;
    },

    HasAutonomousWake(): boolean {
      const s = store.getState();
      if (!s.wakePending || s.pendingScheduledTask != null) return false;
      return s.lastTriggerUserId !== config.ownerUserId;
    },

    async RunAutonomousAgent(): Promise<State> {
      clawLog("tree: RunAutonomousAgent");
      if (runAutonomousAgent) await runAutonomousAgent();
      store.clearWake();
      store.setLastAutonomousRunAt(Date.now());
      return State.SUCCEEDED;
    },

    TimeForAutonomousWake(): boolean {
      const s = store.getState();
      if (s.wakePending) return false;
      if (!config.ownerUserId || config.autonomousSoulTickMs <= 0) return false;
      const ownerAway = s.myPosition != null && !isOwnerNearby(s, config);
      if (!ownerAway) return false;
      const elapsed = Date.now() - s.lastAutonomousRunAt;
      return elapsed >= config.autonomousSoulTickMs;
    },

    RequestAutonomousWake(): State {
      store.setWakePending(true);
      return State.SUCCEEDED;
    },

    ClearWakeIdle(): State {
      store.clearWake();
      return State.SUCCEEDED;
    },
  };
}

/**
 * True if the owner is within ownerNearbyRadiusM of the agent (for TimeForAutonomousWake).
 */
function isOwnerNearby(
  state: { myPosition: { x: number; z: number } | null; occupants: Array<{ userId?: string; position?: { x: number; z: number } }> },
  config: ClawConfig
): boolean {
  if (!state.myPosition || !config.ownerUserId) return false;
  const radiusM = config.ownerNearbyRadiusM;
  const radius2 = radiusM * radiusM;
  for (const o of state.occupants) {
    if (o.userId !== config.ownerUserId || !o.position) continue;
    const dx = o.position.x - state.myPosition.x;
    const dz = o.position.z - state.myPosition.z;
    if (dx * dx + dz * dz <= radius2) return true;
  }
  return false;
}
