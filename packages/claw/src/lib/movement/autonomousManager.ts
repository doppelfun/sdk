/**
 * AutonomousManager: when the agent is idle (owner not nearby), mostly seek other agents
 * and go say something when close; otherwise wander and occasional emote. Runs on the
 * same 50ms cadence as the movement driver; when owner is nearby or a movement target
 * is set, it no-ops so the movement driver handles input.
 */

import type { DoppelClient } from "@doppelfun/sdk";
import type { ClawConfig } from "../config/config.js";
import { isInConversationWithAgentInRoom } from "../state/state.js";
import type { ClawStore } from "../state/index.js";
import { isInConversation } from "../conversation/index.js";
import { clawLog } from "../log.js";
import { isOwnerNearby } from "./ownerProximity.js";
import { getBlockBounds } from "../../util/blockBounds.js";
import { normalizeAngle, lerpAngle, randomRange } from "../../util/math.js";

/** When idle, probability per “idle tick” to try seeking another agent (vs wander/emote). */
const SEEK_AGENT_PROBABILITY = 0.2;
/** Min/max interval (ms) between consider-seeking moments; random per agent to desync. */
const SEEK_INTERVAL_MS = { min: 30_000, max: 90_000 };
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
  tick(client: DoppelClient, store: ClawStore, config: ClawConfig): void {
    const now = Date.now();
    const state = store.getState();

    if (config.ownerUserId && state.myPosition && isOwnerNearby(state, config)) {
      store.setMovementIntent(null);
      store.setAutonomousEmoteStandStillUntil(0);
      store.setPendingGoTalkToAgent(null);
      store.setAutonomousSeekCooldownUntil(0);
      return;
    }

    if (state.movementTarget != null) return;

    if (state.autonomousEmoteStandStillUntil > 0 && now < state.autonomousEmoteStandStillUntil) {
      return;
    }
    store.setAutonomousEmoteStandStillUntil(0);

    const my = state.myPosition;
    if (!my) return;

    // In conversation with another agent here: don’t wander or seek others — stay put (optional in-place emote only).
    if (isInConversationWithAgentInRoom(state)) {
      store.setMovementIntent(null);
      if (Math.random() < EMOTE_PROBABILITY && EMOTES.length > 0) {
        const emote = EMOTES[Math.floor(Math.random() * EMOTES.length)]!;
        client.sendEmote(emote);
        store.setAutonomousEmoteStandStillUntil(now + EMOTE_STAND_STILL_MS);
        clawLog("agent", `autonomous emote ${emote} (in conversation)`);
      }
      return;
    }

    // Consider seeking at most every SEEK_INTERVAL_MS (random range); then roll SEEK_AGENT_PROBABILITY so agents don't sync.
    const inCooldown =
      (state.autonomousSeekCooldownUntil > 0 && now < state.autonomousSeekCooldownUntil) ||
      (state.conversationEndedSeekCooldownUntil > 0 && now < state.conversationEndedSeekCooldownUntil);
    const mayConsiderSeek = now >= (state.nextSeekConsiderAt ?? 0);
    if (mayConsiderSeek) {
      const intervalMs =
        SEEK_INTERVAL_MS.min + Math.random() * (SEEK_INTERVAL_MS.max - SEEK_INTERVAL_MS.min);
      store.setNextSeekConsiderAt(now + intervalMs);
    }
    if (
      mayConsiderSeek &&
      !inCooldown &&
      !isInConversation(store) &&
      Math.random() < SEEK_AGENT_PROBABILITY
    ) {
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
        store.setMovementIntent(null);
        store.setMovementTarget({ x: occ.position!.x, z: occ.position!.z });
        store.setMovementSprint(true);
        store.setPendingGoTalkToAgent({ targetSessionId: occ.clientId, openingMessage });
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

    store.setMovementIntent({ moveX, moveZ, sprint: false });

    if (Math.random() < EMOTE_PROBABILITY && EMOTES.length > 0) {
      const emote = EMOTES[Math.floor(Math.random() * EMOTES.length)]!;
      client.sendEmote(emote);
      store.setAutonomousEmoteStandStillUntil(now + EMOTE_STAND_STILL_MS);
      clawLog("agent", `autonomous emote ${emote}`);
    }
  }
}
