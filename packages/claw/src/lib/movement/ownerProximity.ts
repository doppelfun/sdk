/**
 * Owner proximity: true if the owner is within config.ownerNearbyRadiusM of the agent.
 */
import type { ClawConfig } from "../config/index.js";
import type { ClawState } from "../state/state.js";

/**
 * True if the owner is in the block and within ownerNearbyRadiusM of the agent's position.
 *
 * @param state - Claw state (myPosition, occupants)
 * @param config - Claw config (ownerUserId, ownerNearbyRadiusM)
 * @returns True when owner is nearby
 */
export function isOwnerNearby(state: ClawState, config: ClawConfig): boolean {
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
