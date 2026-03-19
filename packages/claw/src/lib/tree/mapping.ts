/**
 * Single mapping from behaviour tree action node names to TreeAction.
 * Agent callbacks use setCurrentActionForNode(store, nodeName) and setLastCompletedActionForNode(store, nodeName).
 */

import type { ClawStore } from "../state/index.js";
import type { TreeAction } from "../state/index.js";

/**
 * Tree action node name → TreeAction. Only action nodes (not conditions) are listed.
 * Obedient: RunObedientAgent. Autonomous: RunConverseAgent, SeekSocialTarget, TryMoveToNearestOccupant, etc.
 */
export const TREE_NODE_TO_ACTION: Record<string, TreeAction> = {
  ExecuteMovementAndDrain: "movement_only",
  RunObedientAgent: "obedient",
  RunAutonomousAgent: "autonomous_llm",
  RunConverseAgent: "autonomous_converse",
  TryMoveToNearestOccupant: "autonomous_move",
  SeekSocialTarget: "autonomous_seek_social",
  ContinueApproach: "autonomous_move",
  ContinueWaiting: "autonomous_move",
  ExitConversationToWander: "autonomous_move",
  SetWanderGoal: "autonomous_move",
  ClearWakeInsufficientCredits: "clearing_wake_insufficient_credits",
  RequestAutonomousWake: "requesting_autonomous_wake",
  ClearWakeIdle: "idle",
};

/**
 * Set currentAction from the tree node name. No-op if node name is not in the mapping.
 */
export function setCurrentActionForNode(store: ClawStore, nodeName: string): void {
  const action = TREE_NODE_TO_ACTION[nodeName];
  if (action) store.setCurrentAction(action);
}

/**
 * Set lastCompletedAction (and timestamp) from the tree node name. No-op if node name is not in the mapping.
 */
export function setLastCompletedActionForNode(store: ClawStore, nodeName: string): void {
  const action = TREE_NODE_TO_ACTION[nodeName];
  if (action) store.setLastCompletedAction(action);
}
