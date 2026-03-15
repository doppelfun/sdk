/**
 * Movement driver: stick input (movementIntent) or server-driven move_to (target set, no waypoints).
 * When target is set and no waypoints, server drives; we only check arrival and clear target.
 * @see MOVEMENT.md
 */

import type { DoppelClient } from "@doppelfun/sdk";
import { buildChatSendOptions } from "../chatSendOptions.js";
import { canSendDmTo, onWeSentDm } from "../conversation/index.js";
import { getFacingTowardNearestOccupant } from "../state/state.js";
import type { ClawStore } from "../state/index.js";
import { BLOCK_SIZE_M } from "../../util/blockBounds.js";
import { clawLog } from "../log.js";

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
/** Default stop distance (m) when approaching target; server waypoint radius is 1 m. */
export const DEFAULT_STOP_DISTANCE_M = 1;

/** Options for movement driver. voiceId is passed to sendChat when sending autonomous greeting (from CLAW_VOICE_ID). */
export type MovementDriverOptions = { voiceId?: string | null };

/**
 * Shared arrival handling: stop input, clear target/waypoints, optional pendingGoTalkToAgent DM, clear lastBuildTarget.
 */
function applyArrival(
  client: DoppelClient,
  store: ClawStore,
  state: ReturnType<ClawStore["getState"]>,
  my: { x: number; z: number },
  stopDist: number,
  options: MovementDriverOptions | undefined,
  logLabel: string
): void {
  const rotY = getFacingTowardNearestOccupant(state);
  client.sendInput({ moveX: 0, moveZ: 0, sprint: false, jump: false, ...(rotY != null && { rotY }) });
  store.setMovementTarget(null);
  clawLog("arrived at target", logLabel);
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
}

/**
 * One driver tick: apply stick intent, or (for move_to) only check arrival. Server drives movement; we do not send input toward target.
 * Returns true if input was sent this tick.
 */
export function movementDriverTick(
  client: DoppelClient,
  store: ClawStore,
  options?: MovementDriverOptions
): boolean {
  const state = store.getState();
  const target = state.movementTarget;

  // Stand-still window: send 0,0 until timestamp expires (e.g. after emote).
  if (
    target == null &&
    state.autonomousEmoteStandStillUntil > 0 &&
    Date.now() < state.autonomousEmoteStandStillUntil
  ) {
    const rotY = getFacingTowardNearestOccupant(state);
    client.sendInput({ moveX: 0, moveZ: 0, sprint: false, jump: false, ...(rotY != null && { rotY }) });
    return true;
  }

  // Stick input (no target): repeat every tick; clamp at block bounds.
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

  const stopDist = state.movementStopDistanceM ?? DEFAULT_STOP_DISTANCE_M;

  // Server-driven move_to: server pathfinds and applies input each tick; we only check arrival and run arrival logic.
  // While server is driving, do not send input (e.g. encounter stop); server ignores 0,0 when path is active, but we avoid sending so rotY/other fields don't overwrite.
  for (const o of state.occupants) {
    if (o.clientId === state.mySessionId || o.type === "agent" || !o.position) continue;
    const odx = o.position.x - my.x;
    const odz = o.position.z - my.z;
    if (odx * odx + odz * odz < ENCOUNTER_RADIUS2) {
      break;
    }
  }
  const dx = target.x - my.x;
  const dz = target.z - my.z;
  const dist = Math.hypot(dx, dz);
  if (dist < stopDist) {
    applyArrival(client, store, state, my, stopDist, options, "(server pathfinding)");
    return true;
  }
  return false;
}
