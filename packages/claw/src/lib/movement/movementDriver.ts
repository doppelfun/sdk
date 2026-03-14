/**
 * NPC-style continuous movement for the agent.
 * NpcDriver ticks every ~50ms with heading/speed lerp and pendingInput;
 * agents only call move once per LLM tick. This driver sends input at the
 * same interval toward a block-local target (0–100) until within stop distance—smooth
 * approach like NPCs without requiring the LLM to spam move.
 */

import type { DoppelClient } from "@doppelfun/sdk";
import { buildChatSendOptions } from "../chatSendOptions.js";
import { canSendDmTo, onWeSentDm } from "../conversation/index.js";
import { getFacingTowardNearestOccupant } from "../state/state.js";
import type { ClawStore } from "../state/index.js";
import { BLOCK_SIZE_M } from "../../util/blockBounds.js";

/** Match NpcDriver INPUT_INTERVAL_MS so agent motion feels similar. */
export const MOVEMENT_INPUT_INTERVAL_MS = 50;
/** Match NPC_ENCOUNTER_RADIUS — stop moving when a human is this close (optional). */
const ENCOUNTER_RADIUS = 1.5;
const ENCOUNTER_RADIUS2 = ENCOUNTER_RADIUS * ENCOUNTER_RADIUS;
/** Keep this far inside block edges before zeroing velocity component (NpcDriver BOUNDS_MARGIN). Positions are block-local 0–100. */
const BOUNDS_MARGIN = 2;
const LOCAL_X_MIN = BOUNDS_MARGIN;
const LOCAL_X_MAX = BLOCK_SIZE_M - BOUNDS_MARGIN;
const LOCAL_Z_MIN = BOUNDS_MARGIN;
const LOCAL_Z_MAX = BLOCK_SIZE_M - BOUNDS_MARGIN;
/** Default stop distance (m) when approaching target. */
export const DEFAULT_STOP_DISTANCE_M = 2;
/** Direction scale before engine multiplies by walk/run speed (NpcDriver uses ~0.15–0.6). */
const DIRECTION_SPEED = 0.35;
/** Max |moveX|/|moveZ| sent to engine (Claw move tool cap). */
const MAX_MOVE = 0.4;
/** When within this distance (m) of current waypoint, advance to next. */
const WAYPOINT_RADIUS = 1.5;

/** Options for movement driver. voiceId is passed to sendChat when sending autonomous greeting (from CLAW_VOICE_ID). */
export type MovementDriverOptions = { voiceId?: string | null };

/**
 * One driver tick: if movementTarget is set and myPosition known, send sendInput
 * toward target; clear target when within stopDistance. Returns true if input was sent.
 */
export function movementDriverTick(
  client: DoppelClient,
  store: ClawStore,
  options?: MovementDriverOptions
): boolean {
  const state = store.getState();
  const target = state.movementTarget;

  // --- AutonomousManager emote stand-still: send 0,0 until timestamp expires; face nearby if any ---
  if (
    state.autonomousEmoteStandStillUntil > 0 &&
    Date.now() < state.autonomousEmoteStandStillUntil
  ) {
    const rotY = getFacingTowardNearestOccupant(state);
    client.sendInput({ moveX: 0, moveZ: 0, sprint: false, jump: false, ...(rotY != null && { rotY }) });
    return true;
  }

  // --- Continuous stick input (no world target): repeat every tick like NpcDriver pendingInput ---
  if (!target && state.movementIntent) {
    const { moveX, moveZ, sprint } = state.movementIntent;
    const my = state.myPosition;
    let mx = moveX;
    let mz = moveZ;
    if (my) {
      if (my.x <= LOCAL_X_MIN && mx < 0) mx = 0;
      if (my.x >= LOCAL_X_MAX && mx > 0) mx = 0;
      if (my.z <= LOCAL_Z_MIN && mz < 0) mz = 0;
      if (my.z >= LOCAL_Z_MAX && mz > 0) mz = 0;
    }
    client.sendInput({ moveX: mx, moveZ: mz, sprint, jump: false });
    return true;
  }

  if (!target) return false;

  const my = state.myPosition;
  if (!my) return false;

  // Optional: stand still if any non-agent occupant is very close (encounter-style); face them
  for (const o of state.occupants) {
    if (o.clientId === state.mySessionId) continue;
    if (o.type === "agent") continue;
    if (!o.position) continue;
    const dx = o.position.x - my.x;
    const dz = o.position.z - my.z;
    if (dx * dx + dz * dz < ENCOUNTER_RADIUS2) {
      const rotY = Math.atan2(dx, dz);
      client.sendInput({ moveX: 0, moveZ: 0, sprint: false, jump: false, ...{ rotY } });
      return true;
    }
  }

  const stopDist = state.movementStopDistanceM ?? DEFAULT_STOP_DISTANCE_M;

  // Server-authored waypoints: steer toward current waypoint; advance when within radius
  const waypoints = state.movementWaypoints;
  const wIndex = state.movementWaypointIndex;
  if (waypoints?.length && wIndex < waypoints.length) {
    const wp = waypoints[wIndex]!;
    const distToWp = Math.hypot(wp.x - my.x, wp.z - my.z);
    if (distToWp < WAYPOINT_RADIUS) {
      store.advanceMovementWaypoint();
      const nextState = store.getState();
      const nextWp = nextState.movementWaypoints?.[nextState.movementWaypointIndex];
      if (nextWp) {
        const ndx = nextWp.x - my.x;
        const ndz = nextWp.z - my.z;
        const nnorm = Math.hypot(ndx, ndz) || 1;
        let moveX = (ndx / nnorm) * DIRECTION_SPEED;
        let moveZ = (ndz / nnorm) * DIRECTION_SPEED;
        moveX = Math.max(-MAX_MOVE, Math.min(MAX_MOVE, moveX));
        moveZ = Math.max(-MAX_MOVE, Math.min(MAX_MOVE, moveZ));
        if (my.x <= LOCAL_X_MIN && moveX < 0) moveX = 0;
        if (my.x >= LOCAL_X_MAX && moveX > 0) moveX = 0;
        if (my.z <= LOCAL_Z_MIN && moveZ < 0) moveZ = 0;
        if (my.z >= LOCAL_Z_MAX && moveZ > 0) moveZ = 0;
        client.sendInput({ moveX, moveZ, sprint: state.movementSprint === true, jump: false });
        return true;
      }
      // No next waypoint — fall through to check dist to target / straight line
    } else {
      const dx = wp.x - my.x;
      const dz = wp.z - my.z;
      const norm = Math.hypot(dx, dz) || 1;
      let moveX = (dx / norm) * DIRECTION_SPEED;
      let moveZ = (dz / norm) * DIRECTION_SPEED;
      moveX = Math.max(-MAX_MOVE, Math.min(MAX_MOVE, moveX));
      moveZ = Math.max(-MAX_MOVE, Math.min(MAX_MOVE, moveZ));
      if (my.x <= LOCAL_X_MIN && moveX < 0) moveX = 0;
      if (my.x >= LOCAL_X_MAX && moveX > 0) moveX = 0;
      if (my.z <= LOCAL_Z_MIN && moveZ < 0) moveZ = 0;
      if (my.z >= LOCAL_Z_MAX && moveZ > 0) moveZ = 0;
      client.sendInput({ moveX, moveZ, sprint: state.movementSprint === true, jump: false });
      return true;
    }
  }

  // No waypoints or past last waypoint — straight line toward movementTarget
  const dx = target.x - my.x;
  const dz = target.z - my.z;
  const dist = Math.hypot(dx, dz);

  if (dist < stopDist) {
    const rotY = getFacingTowardNearestOccupant(state);
    client.sendInput({ moveX: 0, moveZ: 0, sprint: false, jump: false, ...(rotY != null && { rotY }) });
    store.setMovementTarget(null);
    store.setMovementWaypoints(null);
    const pending = state.pendingGoTalkToAgent;
    if (pending && canSendDmTo(store, pending.targetSessionId)) {
      client.sendChat(
        pending.openingMessage,
        buildChatSendOptions({ targetSessionId: pending.targetSessionId, voiceId: options?.voiceId })
      );
      store.setLastAgentChatMessage(pending.openingMessage);
      onWeSentDm(store, pending.targetSessionId);
      store.setPendingGoTalkToAgent(null);
      store.setAutonomousSeekCooldownUntil(Date.now() + 5000);
    }
    if (
      state.lastBuildTarget &&
      Math.hypot(state.lastBuildTarget.x - my.x, state.lastBuildTarget.z - my.z) < stopDist
    ) {
      store.setLastBuildTarget(null);
    }
    return true;
  }

  let moveX = (dx / dist) * DIRECTION_SPEED;
  let moveZ = (dz / dist) * DIRECTION_SPEED;
  moveX = Math.max(-MAX_MOVE, Math.min(MAX_MOVE, moveX));
  moveZ = Math.max(-MAX_MOVE, Math.min(MAX_MOVE, moveZ));

  // Bounds clamp — positions are block-local 0–100
  if (my.x <= LOCAL_X_MIN && moveX < 0) moveX = 0;
  if (my.x >= LOCAL_X_MAX && moveX > 0) moveX = 0;
  if (my.z <= LOCAL_Z_MIN && moveZ < 0) moveZ = 0;
  if (my.z >= LOCAL_Z_MAX && moveZ > 0) moveZ = 0;

  client.sendInput({
    moveX,
    moveZ,
    sprint: state.movementSprint === true,
    jump: false,
  });
  return true;
}
