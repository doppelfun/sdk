/**
 * AutonomousManager: when the agent is idle (owner not nearby), mostly seek other agents
 * and go say something when close; otherwise wander and occasional emote. Runs on the
 * same 50ms cadence as the movement driver; when owner is nearby or a movement target
 * is set, it no-ops so the movement driver handles input.
 */

import type { DoppelClient } from "@doppelfun/sdk";
import type { ClawConfig } from "../config/config.js";
import { isInConversationWithAgentInRoom, type ClawState } from "../state/state.js";
import { clawLog } from "../log.js";
import { isOwnerNearby } from "./ownerProximity.js";
import { getBlockBounds } from "../../util/blockBounds.js";

/** When idle, probability per “idle tick” to try seeking another agent (vs wander/emote). */
const SEEK_AGENT_PROBABILITY = 0.8;
/** Short greetings when autonomously approaching another agent. */
const OPENING_GREETINGS = ["Hi!", "Hey there!", "Hello!", "What's up?", "Hi there!"] as const;

/** Emote ids matching engine catalog (see toolsZod / @doppel-engine/schema EMOTES). */
const EMOTES = ["wave", "heart", "thumbs", "clap", "dance", "shocked"] as const;

/** Chance per tick to trigger an emote when wandering; lower = less frequent. */
const EMOTE_PROBABILITY = 0.005;
/** Duration (ms) agent stands still while emote plays. */
const EMOTE_STAND_STILL_MS = 3000;
/** Keep agent this many meters inside block edges. */
const BOUNDS_MARGIN = 2;
const HEADING_RETARGET_MS = { min: 800, max: 2800 };
const SPEED_RETARGET_MS = { min: 600, max: 2200 };

type BotState = {
  heading: number;
  targetHeading: number;
  speed: number;
  targetSpeed: number;
  nextHeadingRetargetAt: number;
  nextSpeedRetargetAt: number;
};

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

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomWeightedSpeed(): number {
  const r = Math.random();
  if (r < 0.25) return 0;
  if (r < 0.55) return randomRange(0.15, 0.35);
  return randomRange(0.35, 0.6);
}

function createBotState(now: number): BotState {
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

export class AutonomousManager {
  private botState: BotState = createBotState(Date.now());

  /**
   * One tick: when owner is not nearby (or no owner configured), run autonomous behavior
   * (seek other agents, wander, emote). When owner is configured and nearby, clear state and return.
   * When movementTarget is set, movement driver owns input.
   */
  tick(client: DoppelClient, state: ClawState, config: ClawConfig): void {
    const now = Date.now();

    if (config.ownerUserId && state.myPosition && isOwnerNearby(state, config)) {
      state.movementIntent = null;
      state.autonomousEmoteStandStillUntil = 0;
      state.pendingGoTalkToAgent = null;
      state.autonomousSeekCooldownUntil = 0;
      return;
    }

    if (state.movementTarget != null) return;

    if (state.autonomousEmoteStandStillUntil > 0 && now < state.autonomousEmoteStandStillUntil) {
      return;
    }
    state.autonomousEmoteStandStillUntil = 0;

    const my = state.myPosition;
    if (!my) return;

    // In conversation with another agent here: don’t wander or seek others — stay put (optional in-place emote only).
    if (isInConversationWithAgentInRoom(state)) {
      state.movementIntent = null;
      if (Math.random() < EMOTE_PROBABILITY && EMOTES.length > 0) {
        const emote = EMOTES[Math.floor(Math.random() * EMOTES.length)]!;
        client.sendEmote(emote);
        state.autonomousEmoteStandStillUntil = now + EMOTE_STAND_STILL_MS;
        clawLog("agent", `autonomous emote ${emote} (in conversation)`);
      }
      return;
    }

    // Prefer seeking another agent when not in cooldown and we have other agents in block
    const inCooldown = state.autonomousSeekCooldownUntil > 0 && now < state.autonomousSeekCooldownUntil;
    if (!inCooldown && Math.random() < SEEK_AGENT_PROBABILITY) {
      const others = state.occupants.filter(
        (o) =>
          o.type === "agent" &&
          o.clientId !== state.mySessionId &&
          o.position != null
      );
      if (others.length > 0) {
        const occ = others[Math.floor(Math.random() * others.length)]!;
        const openingMessage =
          OPENING_GREETINGS[Math.floor(Math.random() * OPENING_GREETINGS.length)]!;
        state.movementIntent = null;
        state.movementTarget = { x: occ.position!.x, z: occ.position!.z };
        state.movementSprint = true;
        state.pendingGoTalkToAgent = { targetSessionId: occ.clientId, openingMessage };
        client.sendInput({ moveX: 0, moveZ: 0, sprint: false, jump: false });
        clawLog("agent", `autonomous seek ${occ.username ?? occ.clientId} — will say "${openingMessage}" when close`);
        return;
      }
    }

    const bs = this.botState;
    if (now >= bs.nextHeadingRetargetAt) {
      const maxTurn = Math.random() < 0.12 ? Math.PI * 0.7 : Math.PI * 0.2;
      bs.targetHeading = normalizeAngle(bs.heading + randomRange(-maxTurn, maxTurn));
      bs.nextHeadingRetargetAt = now + randomRange(HEADING_RETARGET_MS.min, HEADING_RETARGET_MS.max);
    }
    if (now >= bs.nextSpeedRetargetAt) {
      bs.targetSpeed = randomWeightedSpeed();
      bs.nextSpeedRetargetAt = now + randomRange(SPEED_RETARGET_MS.min, SPEED_RETARGET_MS.max);
    }
    bs.heading = lerpAngle(bs.heading, bs.targetHeading, 0.22);
    bs.speed += (bs.targetSpeed - bs.speed) * 0.18;
    let moveX = Math.cos(bs.heading) * bs.speed;
    let moveZ = Math.sin(bs.heading) * bs.speed;

    const bounds = getBlockBounds(state.blockSlotId);
    const xMin = bounds.xMin + BOUNDS_MARGIN;
    const xMax = bounds.xMax - BOUNDS_MARGIN;
    const zMin = bounds.zMin + BOUNDS_MARGIN;
    const zMax = bounds.zMax - BOUNDS_MARGIN;
    if (my.x <= xMin && moveX < 0) moveX = 0;
    if (my.x >= xMax && moveX > 0) moveX = 0;
    if (my.z <= zMin && moveZ < 0) moveZ = 0;
    if (my.z >= zMax && moveZ > 0) moveZ = 0;

    state.movementIntent = { moveX, moveZ, sprint: false };

    if (Math.random() < EMOTE_PROBABILITY && EMOTES.length > 0) {
      const emote = EMOTES[Math.floor(Math.random() * EMOTES.length)]!;
      client.sendEmote(emote);
      state.autonomousEmoteStandStillUntil = now + EMOTE_STAND_STILL_MS;
      clawLog("agent", `autonomous emote ${emote}`);
    }
  }
}
