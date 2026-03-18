/**
 * Movement driver: apply movementIntent or check arrival for movementTarget (server-driven move_to).
 * When idle (no target, no intent), runs random wander (engine NPC-style heading/speed).
 */
import type { DoppelClient } from "@doppelfun/sdk";
import { buildChatSendOptions } from "../../util/chatSendOptions.js";
import { canSendDmTo, onWeSentDm } from "../conversation.js";
import { getFacingTowardNearestOccupant } from "../../util/position.js";
import type { ClawStore } from "../state/index.js";
import type { WanderState } from "../state/index.js";
import { BLOCK_SIZE_M } from "../../util/blockBounds.js";
import { clawLog } from "../../util/log.js";

export const MOVEMENT_INPUT_INTERVAL_MS = 50;
const BOUNDS_MARGIN = 2;
const LOCAL_X_MIN = BOUNDS_MARGIN;
const LOCAL_X_MAX = BLOCK_SIZE_M - BOUNDS_MARGIN;
const LOCAL_Z_MIN = BOUNDS_MARGIN;
const LOCAL_Z_MAX = BLOCK_SIZE_M - BOUNDS_MARGIN;
export const DEFAULT_STOP_DISTANCE_M = 1;

// --- Random wander (aligned with engine NpcDriver) ---
const HEADING_RETARGET_MS = { min: 800, max: 2800 };
const SPEED_RETARGET_MS = { min: 600, max: 2200 };
/** Below this speed we send 0,0 so walk animation doesn't play. */
const WANDER_SPEED_THRESHOLD = 0.08;

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function normalizeAngle(angle: number): number {
  let out = angle;
  while (out > Math.PI) out -= Math.PI * 2;
  while (out < -Math.PI) out += Math.PI * 2;
  return out;
}

function lerpAngle(current: number, target: number, t: number): number {
  const delta = normalizeAngle(target - current);
  return normalizeAngle(current + delta * t);
}

/** Speed multiplier; lower = agents move around less. */
function randomWeightedSpeed(): number {
  const r = Math.random();
  if (r < 0.25) return 0;
  if (r < 0.55) return randomRange(0.15, 0.35);
  return randomRange(0.35, 0.6);
}

function createInitialWanderState(now: number): WanderState {
  const heading = randomRange(-Math.PI, Math.PI);
  return {
    heading,
    targetHeading: heading,
    speed: randomWeightedSpeed(),
    targetSpeed: randomWeightedSpeed(),
    nextHeadingRetargetAt: now + randomRange(HEADING_RETARGET_MS.min, HEADING_RETARGET_MS.max),
    nextSpeedRetargetAt: now + randomRange(SPEED_RETARGET_MS.min, SPEED_RETARGET_MS.max),
  };
}

/**
 * Advance wander state one tick and set movementIntent from it (unit direction when speed >= threshold).
 * Called when there is no movementTarget and no movementIntent (idle); keeps autonomous agents moving randomly.
 */
function wanderTick(store: ClawStore): void {
  const now = Date.now();
  let w = store.getState().wanderState;
  if (!w) {
    w = createInitialWanderState(now);
    store.setWanderState(w);
  }
  if (now >= w.nextHeadingRetargetAt) {
    const maxTurn = Math.random() < 0.12 ? Math.PI * 0.7 : Math.PI * 0.2;
    w = {
      ...w,
      targetHeading: normalizeAngle(w.heading + randomRange(-maxTurn, maxTurn)),
      nextHeadingRetargetAt: now + randomRange(HEADING_RETARGET_MS.min, HEADING_RETARGET_MS.max),
    };
    store.setWanderState(w);
  }
  if (now >= w.nextSpeedRetargetAt) {
    w = {
      ...w,
      targetSpeed: randomWeightedSpeed(),
      nextSpeedRetargetAt: now + randomRange(SPEED_RETARGET_MS.min, SPEED_RETARGET_MS.max),
    };
    store.setWanderState(w);
  }
  const heading = lerpAngle(w.heading, w.targetHeading, 0.22);
  const speed = w.speed + (w.targetSpeed - w.speed) * 0.18;
  store.setWanderState({
    ...w,
    heading,
    speed,
  });
  const moveX = speed < WANDER_SPEED_THRESHOLD ? 0 : Math.cos(heading);
  const moveZ = speed < WANDER_SPEED_THRESHOLD ? 0 : Math.sin(heading);
  store.setMovementIntent({ moveX, moveZ, sprint: false });
}

export type MovementDriverOptions = {
  voiceId?: string | null;
  /** When voice is used for arrival DM, call with character count for usage telemetry. */
  onVoiceSent?: (characters: number) => void;
};

/**
 * On arrival at movement target: send zero input, clear target, optionally send pendingGoTalkToAgent DM and clear lastBuildTarget.
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
  const rotY = getFacingTowardNearestOccupant(state.occupants, state.mySessionId, state.myPosition);
  client.sendInput?.({ moveX: 0, moveZ: 0, sprint: false, jump: false, ...(rotY != null && { rotY }) });
  store.setMovementTarget(null);
  clawLog("arrived at target", logLabel);
  const pending = state.pendingGoTalkToAgent;
  if (pending && canSendDmTo(store, pending.targetSessionId)) {
    const voiceId = options?.voiceId;
    client.sendChat?.(
      pending.openingMessage,
      buildChatSendOptions({ targetSessionId: pending.targetSessionId, voiceId }) ?? undefined
    );
    if (voiceId && options?.onVoiceSent) {
      options.onVoiceSent(pending.openingMessage.length);
    }
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
 * One movement driver tick: apply movementIntent (client.sendInput), or check arrival at movementTarget (clear, optional pendingGoTalkToAgent).
 * Respects autonomousEmoteStandStillUntil (send zero input until then).
 *
 * @param client - Engine client (sendInput, sendChat)
 * @param store - Claw store
 * @param options - voiceId for DM on arrival
 * @returns True if we sent input or handled arrival
 */
export function movementDriverTick(
  client: DoppelClient,
  store: ClawStore,
  options?: MovementDriverOptions
): boolean {
  let state = store.getState();
  const target = state.movementTarget;

  if (
    target == null &&
    state.autonomousEmoteStandStillUntil > 0 &&
    Date.now() < state.autonomousEmoteStandStillUntil
  ) {
    const rotY = getFacingTowardNearestOccupant(state.occupants, state.mySessionId, state.myPosition);
    client.sendInput?.({ moveX: 0, moveZ: 0, sprint: false, jump: false, ...(rotY != null && { rotY }) });
    return true;
  }

  // When idle (no target, no intent, not following), run random wander so autonomous agents move like engine NPCs
  if (!target && !state.movementIntent && !state.followTargetSessionId) {
    wanderTick(store);
    state = store.getState();
  }

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
    client.sendInput?.({ moveX: mx, moveZ: mz, sprint, jump: false });
    return true;
  }

  if (!target) return false;

  const my = state.myPosition;
  if (!my) return false;

  const stopDist = state.movementStopDistanceM ?? DEFAULT_STOP_DISTANCE_M;

  const dx = target.x - my.x;
  const dz = target.z - my.z;
  const dist = Math.hypot(dx, dz);
  if (dist < stopDist) {
    applyArrival(client, store, state, my, stopDist, options, "(server pathfinding)");
    return true;
  }
  return false;
}
