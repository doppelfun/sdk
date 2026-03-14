/**
 * Owner proximity: when OWNER_USER_ID is in range, agent should only act on instructions.
 * When owner is away, soul ticks drive behavior; when nearby, obedient mode only.
 */

import type { ClawConfig } from "../config/index.js";
import type { ClawState } from "../state/state.js";

/**
 * True if configured owner is within radius of agent (same block, has position).
 * False if owner not in occupants or too far. Null config.ownerUserId → false (no owner = not "nearby" for gating; caller treats as autonomous).
 */
export function isOwnerNearby(state: ClawState, config: ClawConfig): boolean {
  if (!config.ownerUserId || !state.myPosition) return false;
  const r = config.ownerNearbyRadiusM;
  const r2 = r * r;
  for (const o of state.occupants) {
    if (o.userId !== config.ownerUserId) continue;
    if (!o.position) continue;
    const dx = o.position.x - state.myPosition.x;
    const dz = o.position.z - state.myPosition.z;
    if (dx * dx + dz * dz <= r2) return true;
  }
  return false;
}
