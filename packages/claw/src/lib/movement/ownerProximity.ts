/**
 * Owner proximity: true if the owner is within config.ownerNearbyRadiusM of the agent.
 */
import type { ClawConfig } from "../config/index.js";
import type { ClawState } from "../state/state.js";
import { isOwnerNearby as isOwnerNearbyPosition } from "../../util/position.js";

/**
 * True if the owner is in the block and within ownerNearbyRadiusM of the agent's position.
 *
 * @param state - Claw state (myPosition, occupants)
 * @param config - Claw config (ownerUserId, ownerNearbyRadiusM)
 * @returns True when owner is nearby
 */
export function isOwnerNearby(state: ClawState, config: ClawConfig): boolean {
  return isOwnerNearbyPosition(
    state.occupants,
    state.myPosition,
    config.ownerUserId,
    config.ownerNearbyRadiusM
  );
}
