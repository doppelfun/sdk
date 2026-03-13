/**
 * NPC-style continuous movement for the agent.
 * NpcDriver ticks every ~50ms with heading/speed lerp and pendingInput;
 * agents only called move once per LLM tick. This driver sends input at the
 * same interval toward a world target until within stop distance—smooth
 * approach like NPCs without requiring the LLM to spam move.
 */

import type { DoppelClient } from "@doppelfun/sdk";
import type { ClawState } from "../state/state.js";
import { getBlockBounds } from "../../util/blockBounds.js";
import { clawLog } from "../log.js";

/** Match NpcDriver INPUT_INTERVAL_MS so agent motion feels similar. */
export const MOVEMENT_INPUT_INTERVAL_MS = 50;
/** Match NPC_ENCOUNTER_RADIUS — stop moving when a human is this close (optional). */
const ENCOUNTER_RADIUS = 1.5;
const ENCOUNTER_RADIUS2 = ENCOUNTER_RADIUS * ENCOUNTER_RADIUS;
/** Keep this far inside block edges before zeroing velocity component (NpcDriver BOUNDS_MARGIN). */
const BOUNDS_MARGIN = 2;
/** Default stop distance (m) when approaching target. */
export const DEFAULT_STOP_DISTANCE_M = 2;
/** When within this distance of a waypoint, advance to the next. Also advance if we've passed it (avoids oscillation). */
const WAYPOINT_REACHED_M = 1;
/** Direction magnitude when approaching (sprint). 0.5 × MOVE_SPEED_RUN ≈ 4 m/s, similar to player walk. */
const DIRECTION_SPEED = 0.5;
/** Max |moveX|/|moveZ| per axis when approaching. */
const MAX_MOVE = 0.5;

/**
 * One driver tick: if movementTarget is set and myPosition known, send sendInput
 * toward target; clear target when within stopDistance. Returns true if input was sent.
 */
export function movementDriverTick(client: DoppelClient, state: ClawState): boolean {
  const target = state.movementTarget;

  // --- Continuous stick input (no world target): repeat every tick like NpcDriver pendingInput ---
  if (!target && state.movementIntent) {
    const { moveX, moveZ, sprint } = state.movementIntent;
    const my = state.myPosition;
    let mx = moveX;
    let mz = moveZ;
    if (my) {
      const bounds = getBlockBounds(state.blockSlotId);
      const xMin = bounds.xMin + BOUNDS_MARGIN;
      const xMax = bounds.xMax - BOUNDS_MARGIN;
      const zMin = bounds.zMin + BOUNDS_MARGIN;
      const zMax = bounds.zMax - BOUNDS_MARGIN;
      if (my.x <= xMin && mx < 0) mx = 0;
      if (my.x >= xMax && mx > 0) mx = 0;
      if (my.z <= zMin && mz < 0) mz = 0;
      if (my.z >= zMax && mz > 0) mz = 0;
    }
    client.sendInput({ moveX: mx, moveZ: mz, sprint, jump: false });
    return true;
  }

  if (!target) return false;

  // Refresh position periodically while moving so steer direction stays correct (engine moves us; we only get position from occupants API)
  const refreshState = state as { _positionRefreshTicks?: number };
  refreshState._positionRefreshTicks = (refreshState._positionRefreshTicks ?? 0) + 1;
  if (refreshState._positionRefreshTicks >= 30) {
    refreshState._positionRefreshTicks = 0;
    client.getOccupants().then((list) => {
      state.occupants = list;
      const self = state.mySessionId ? list.find((o) => o.clientId === state.mySessionId && o.position) : null;
      if (self?.position) state.myPosition = self.position;
    }).catch(() => {});
  }

  const my = state.myPosition;
  if (!my) {
    clawLog("[movement] skip: movementTarget set but myPosition is null");
    return false;
  }

  // Optional: stand still if any non-agent occupant is very close (encounter-style)
  for (const o of state.occupants) {
    if (o.clientId === state.mySessionId) continue;
    if (o.type === "agent") continue;
    if (!o.position) continue;
    const dx = o.position.x - my.x;
    const dz = o.position.z - my.z;
    if (dx * dx + dz * dz < ENCOUNTER_RADIUS2) {
      client.sendInput({ moveX: 0, moveZ: 0, sprint: false, jump: false });
      return true;
    }
  }

  // Pathfinding: steer toward current waypoint; when close or when we've passed it, advance. When no waypoints left, steer to final target.
  const waypoints = state.movementWaypoints;
  let steerTarget = target;
  if (Array.isArray(waypoints) && waypoints.length > 0) {
    steerTarget = waypoints[0]!;
    const toWaypoint = Math.hypot(steerTarget.x - my.x, steerTarget.z - my.z);
    const toTargetX = target.x - my.x;
    const toTargetZ = target.z - my.z;
    const toWpX = steerTarget.x - my.x;
    const toWpZ = steerTarget.z - my.z;
    const passedWaypoint = toTargetX * toWpX + toTargetZ * toWpZ <= 0;
    if (toWaypoint < WAYPOINT_REACHED_M || passedWaypoint) {
      state.movementWaypoints = waypoints.length === 1 ? null : waypoints.slice(1);
      if (state.movementWaypoints?.length === 0) state.movementWaypoints = null;
      if (!state.movementWaypoints) {
        steerTarget = target;
      } else {
        steerTarget = state.movementWaypoints[0]!;
      }
    }
  }

  const dx = steerTarget.x - my.x;
  const dz = steerTarget.z - my.z;
  const dist = Math.hypot(dx, dz);
  const stopDist = state.movementStopDistanceM ?? DEFAULT_STOP_DISTANCE_M;

  // Only clear target when within stopDist of the *final* destination, not the current waypoint
  const distToFinal = Math.hypot(target.x - my.x, target.z - my.z);
  if (distToFinal < stopDist) {
    clawLog("[movement] reached target", "my=", my.x.toFixed(1), my.z.toFixed(1), "target=", target.x.toFixed(1), target.z.toFixed(1), "dist=", distToFinal.toFixed(2));
    client.sendInput({ moveX: 0, moveZ: 0, sprint: false, jump: false });
    state.movementTarget = null;
    state.movementWaypoints = null;
    (state as { _positionRefreshTicks?: number })._positionRefreshTicks = 0;
    if (
      state.lastBuildTarget &&
      Math.hypot(state.lastBuildTarget.x - my.x, state.lastBuildTarget.z - my.z) < stopDist
    ) {
      state.lastBuildTarget = null;
    }
    return true;
  }

  let moveX = (dx / dist) * DIRECTION_SPEED;
  let moveZ = (dz / dist) * DIRECTION_SPEED;
  moveX = Math.max(-MAX_MOVE, Math.min(MAX_MOVE, moveX));
  moveZ = Math.max(-MAX_MOVE, Math.min(MAX_MOVE, moveZ));

  // Bounds clamp like NpcDriver — don't push into block edge
  const bounds = getBlockBounds(state.blockSlotId);
  const xMin = bounds.xMin + BOUNDS_MARGIN;
  const xMax = bounds.xMax - BOUNDS_MARGIN;
  const zMin = bounds.zMin + BOUNDS_MARGIN;
  const zMax = bounds.zMax - BOUNDS_MARGIN;
  if (my.x <= xMin && moveX < 0) moveX = 0;
  if (my.x >= xMax && moveX > 0) moveX = 0;
  if (my.z <= zMin && moveZ < 0) moveZ = 0;
  if (my.z >= zMax && moveZ > 0) moveZ = 0;

  // Log every ~1s when moving toward target (throttle to avoid spam)
  const wpCount = Array.isArray(waypoints) ? waypoints.length : 0;
  const moveState = state as { _moveLogTick?: number };
  moveState._moveLogTick = (moveState._moveLogTick ?? 0) + 1;
  if (moveState._moveLogTick % 20 === 1) {
    clawLog(
      "[movement] steer",
      "my=(",
      my.x.toFixed(1),
      ",",
      my.z.toFixed(1),
      ") steerTarget=(",
      steerTarget.x.toFixed(1),
      ",",
      steerTarget.z.toFixed(1),
      ") waypoints=",
      wpCount,
      "dist=",
      dist.toFixed(1),
      "stopDist=",
      stopDist,
      "moveX=",
      moveX.toFixed(3),
      "moveZ=",
      moveZ.toFixed(3)
    );
  }

  // Walk when following waypoints (avoids overshooting and oscillation); sprint when going straight to target
  const hasWaypoints = Array.isArray(state.movementWaypoints) && state.movementWaypoints.length > 0;
  const useSprint = !hasWaypoints && state.movementSprint !== false;
  client.sendInput({
    moveX,
    moveZ,
    sprint: useSprint,
    jump: false,
  });
  return true;
}
