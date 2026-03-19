/**
 * Single mapping from behaviour tree action node names to TreeAction.
 * Keeps the contract in one place; agent callbacks use setCurrentActionForNode(store, nodeName).
 */

import type { ClawStore } from "../state/index.js";
import type { TreeAction } from "../state/index.js";

/** Tree action node name → TreeAction. Only action nodes (not conditions) are listed. */
export const TREE_NODE_TO_ACTION: Record<string, TreeAction> = {
  ExecuteMovementAndDrain: "movement_only",
  RunObedientAgent: "obedient",
  RunAutonomousAgent: "autonomous_llm",
  TryMoveToNearestOccupant: "autonomous_move",
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
