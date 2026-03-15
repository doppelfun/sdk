/**
 * AutonomousManager: when the agent is idle (owner not nearby), prioritize seeking other
 * agents or players and talking to them (via move_to); only wander when no one to seek or
 * in cooldown. Wandering uses move_to(random x, z) so the server pathfinds. Runs on the same
 * 50ms cadence as the movement driver; when owner is nearby or a movement target is set, it no-ops.
 */

import type { DoppelClient } from "@doppelfun/sdk";
import type { ClawConfig } from "../config/index.js";
import { isInConversationWithAgentInRoom } from "../state/state.js";
import type { ClawStore } from "../state/index.js";
import { isInConversation } from "../conversation/index.js";
import { clawLog } from "../log.js";
import { isOwnerNearby } from "./ownerProximity.js";
import { BLOCK_SIZE_M } from "../../util/blockBounds.js";
import { randomRange } from "../../util/math.js";

/** Min/max interval (ms) between consider-seeking moments. When others are present, seeking is preferred over wandering. */
const SEEK_INTERVAL_MS = { min: 10_000, max: 45_000 };
/** Short greetings when autonomously approaching another agent or player. */
const OPENING_GREETINGS = ["Hi!", "Hey there!", "Hello!", "What's up?", "Hi there!"] as const;

/** Emote ids matching engine catalog (see toolsZod / @doppel-engine/schema EMOTES). */
const EMOTES = ["wave", "heart", "thumbs", "clap", "dance", "shocked"] as const;

/** Chance per tick to trigger an emote when wandering or in conversation; kept low so emotes are rare. */
const EMOTE_PROBABILITY = 0.0004;
/** Minimum ms between autonomous emotes (hard cap so we never spam). */
const EMOTE_MIN_INTERVAL_MS = 60_000;
/** Duration (ms) agent stands still while emote plays. */
const EMOTE_STAND_STILL_MS = 3000;
/** Keep wander targets this many meters inside block edges. Positions are block-local 0–100. */
const WANDER_BOUNDS_MARGIN = 5;
const WANDER_X_MIN = WANDER_BOUNDS_MARGIN;
const WANDER_X_MAX = BLOCK_SIZE_M - WANDER_BOUNDS_MARGIN;
const WANDER_Z_MIN = WANDER_BOUNDS_MARGIN;
const WANDER_Z_MAX = BLOCK_SIZE_M - WANDER_BOUNDS_MARGIN;
/** Min/max ms before picking a new random wander destination (when idle and no one to seek). */
const WANDER_INTERVAL_MS = { min: 15_000, max: 45_000 };

export class AutonomousManager {
  private lastAutonomousEmoteAt = 0;
  private nextWanderConsiderAt = 0;

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
      const mayEmoteConv =
        now - this.lastAutonomousEmoteAt >= EMOTE_MIN_INTERVAL_MS &&
        Math.random() < EMOTE_PROBABILITY &&
        EMOTES.length > 0;
      if (mayEmoteConv) {
        this.lastAutonomousEmoteAt = now;
        const emote = EMOTES[Math.floor(Math.random() * EMOTES.length)]!;
        client.sendEmote(emote);
        store.setAutonomousEmoteStandStillUntil(now + EMOTE_STAND_STILL_MS);
        clawLog("agent", `autonomous emote ${emote} (in conversation)`);
      }
      return;
    }

    // Prioritize seeking: when it's time to consider and we're not in cooldown, if anyone is available, seek them (no random roll).
    const inCooldown =
      (state.autonomousSeekCooldownUntil > 0 && now < state.autonomousSeekCooldownUntil) ||
      (state.conversationEndedSeekCooldownUntil > 0 && now < state.conversationEndedSeekCooldownUntil);
    const mayConsiderSeek = now >= (state.nextSeekConsiderAt ?? 0);
    if (mayConsiderSeek) {
      const intervalMs =
        SEEK_INTERVAL_MS.min + Math.random() * (SEEK_INTERVAL_MS.max - SEEK_INTERVAL_MS.min);
      store.setNextSeekConsiderAt(now + intervalMs);
    }
    const others = state.occupants.filter(
      (o) =>
        o.clientId !== state.mySessionId &&
        o.position != null &&
        (o.type === "agent" || o.type === "user")
    );
    if (mayConsiderSeek && !inCooldown && !isInConversation(store) && others.length > 0) {
      const occ = others[Math.floor(Math.random() * others.length)]!;
      const toX = occ.position!.x;
      const toZ = occ.position!.z;
      const openingMessage =
        OPENING_GREETINGS[Math.floor(Math.random() * OPENING_GREETINGS.length)]!;
      store.setMovementIntent(null);
      store.setMovementTarget({ x: toX, z: toZ });
      store.setMovementSprint(true);
      store.setPendingGoTalkToAgent({ targetSessionId: occ.clientId, openingMessage });
      store.setLastMoveToFailed(null);
      store.setAutonomousEmoteStandStillUntil(0);
      client.moveTo(toX, toZ);
      clawLog("agent", `autonomous seek ${occ.username ?? occ.clientId} → (${toX.toFixed(1)}, ${toZ.toFixed(1)}) — will say "${openingMessage}" when close`);
      return;
    }

    // Wander: move_to a random point when it's time. Server pathfinds; on arrival we idle until next interval.
    const mayWander = now >= this.nextWanderConsiderAt;
    if (mayWander) {
      const wanderX = randomRange(WANDER_X_MIN, WANDER_X_MAX);
      const wanderZ = randomRange(WANDER_Z_MIN, WANDER_Z_MAX);
      const intervalMs =
        WANDER_INTERVAL_MS.min + Math.random() * (WANDER_INTERVAL_MS.max - WANDER_INTERVAL_MS.min);
      this.nextWanderConsiderAt = now + intervalMs;
      store.setMovementIntent(null);
      store.setMovementTarget({ x: wanderX, z: wanderZ });
      store.setMovementSprint(false);
      store.setLastMoveToFailed(null);
      store.setAutonomousEmoteStandStillUntil(0);
      client.moveTo(wanderX, wanderZ);
      clawLog("agent", `autonomous wander → (${wanderX.toFixed(1)}, ${wanderZ.toFixed(1)})`);
      return;
    }

    store.setMovementIntent(null);

    const mayEmote =
      now - this.lastAutonomousEmoteAt >= EMOTE_MIN_INTERVAL_MS &&
      Math.random() < EMOTE_PROBABILITY &&
      EMOTES.length > 0;
    if (mayEmote) {
      this.lastAutonomousEmoteAt = now;
      const emote = EMOTES[Math.floor(Math.random() * EMOTES.length)]!;
      client.sendEmote(emote);
      store.setAutonomousEmoteStandStillUntil(now + EMOTE_STAND_STILL_MS);
      clawLog("agent", `autonomous emote ${emote}`);
    }
  }
}
