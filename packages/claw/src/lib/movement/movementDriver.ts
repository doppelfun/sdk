/**
 * Movement driver: apply movementIntent or check arrival for movementTarget (server-driven move_to).
 */
import type { DoppelClient } from "@doppelfun/sdk";
import { buildChatSendOptions } from "../../util/chatSendOptions.js";
import { canSendDmTo, onWeSentDm } from "../conversation.js";
import { getFacingTowardNearestOccupant } from "../state/state.js";
import type { ClawStore } from "../state/index.js";
import { BLOCK_SIZE_M } from "../../util/blockBounds.js";
import { clawLog } from "../../util/log.js";

export const MOVEMENT_INPUT_INTERVAL_MS = 50;
const BOUNDS_MARGIN = 2;
const LOCAL_X_MIN = BOUNDS_MARGIN;
const LOCAL_X_MAX = BLOCK_SIZE_M - BOUNDS_MARGIN;
const LOCAL_Z_MIN = BOUNDS_MARGIN;
const LOCAL_Z_MAX = BLOCK_SIZE_M - BOUNDS_MARGIN;
export const DEFAULT_STOP_DISTANCE_M = 1;

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
  const rotY = getFacingTowardNearestOccupant(state);
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
  const state = store.getState();
  const target = state.movementTarget;

  if (
    target == null &&
    state.autonomousEmoteStandStillUntil > 0 &&
    Date.now() < state.autonomousEmoteStandStillUntil
  ) {
    const rotY = getFacingTowardNearestOccupant(state);
    client.sendInput?.({ moveX: 0, moveZ: 0, sprint: false, jump: false, ...(rotY != null && { rotY }) });
    return true;
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
