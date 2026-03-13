/**
 * NPC-style continuous movement for the agent.
 * NpcDriver ticks every ~50ms with heading/speed lerp and pendingInput;
 * agents only called move once per LLM tick. This driver sends input at the
 * same interval toward a world target until within stop distance—smooth
 * approach like NPCs without requiring the LLM to spam move.
 */

import type { DoppelClient } from "@doppelfun/sdk";
import {
  type ClawState,
  getFacingTowardNearestOccupant,
  isAgentChatCooldownActive,
  setAgentChatCooldown,
} from "../state/state.js";
import { getBlockBounds } from "../../util/blockBounds.js";

/** Match NpcDriver INPUT_INTERVAL_MS so agent motion feels similar. */
export const MOVEMENT_INPUT_INTERVAL_MS = 50;
/** Match NPC_ENCOUNTER_RADIUS — stop moving when a human is this close (optional). */
const ENCOUNTER_RADIUS = 1.5;
const ENCOUNTER_RADIUS2 = ENCOUNTER_RADIUS * ENCOUNTER_RADIUS;
/** Keep this far inside block edges before zeroing velocity component (NpcDriver BOUNDS_MARGIN). */
const BOUNDS_MARGIN = 2;
/** Default stop distance (m) when approaching target. */
export const DEFAULT_STOP_DISTANCE_M = 2;
/** Direction scale before engine multiplies by walk/run speed (NpcDriver uses ~0.15–0.6). */
const DIRECTION_SPEED = 0.35;
/** Max |moveX|/|moveZ| sent to engine (Claw move tool cap). */
const MAX_MOVE = 0.4;

/**
 * One driver tick: if movementTarget is set and myPosition known, send sendInput
 * toward target; clear target when within stopDistance. Returns true if input was sent.
 */
export function movementDriverTick(client: DoppelClient, state: ClawState): boolean {
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

  const dx = target.x - my.x;
  const dz = target.z - my.z;
  const dist = Math.hypot(dx, dz);
  const stopDist = state.movementStopDistanceM ?? DEFAULT_STOP_DISTANCE_M;

  if (dist < stopDist) {
    const rotY = getFacingTowardNearestOccupant(state);
    client.sendInput({ moveX: 0, moveZ: 0, sprint: false, jump: false, ...(rotY != null && { rotY }) });
    state.movementTarget = null;
    const pending = state.pendingGoTalkToAgent;
    if (pending) {
      // Wait for agent chat cooldown so we don’t spam; will send on a later tick when expired.
      if (!isAgentChatCooldownActive(state)) {
        client.sendChat(pending.openingMessage, { targetSessionId: pending.targetSessionId });
        client.sendSpeak(pending.openingMessage);
        state.lastAgentChatMessage = pending.openingMessage;
        state.lastDmPeerSessionId = pending.targetSessionId;
        setAgentChatCooldown(state);
        state.pendingGoTalkToAgent = null;
        state.autonomousSeekCooldownUntil = Date.now() + 5000;
      }
    }
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

  client.sendInput({
    moveX,
    moveZ,
    sprint: state.movementSprint === true,
    jump: false,
  });
  return true;
}
