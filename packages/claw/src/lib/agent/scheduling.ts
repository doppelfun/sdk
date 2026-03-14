/**
 * Tick loop scheduling: when to run the next tick (getNextTickDelay) and
 * coordination via TickScheduler (refs replaced by explicit API).
 */

import type { ClawState } from "../state/state.js";
import type { ClawConfig } from "../config/index.js";
import { isOwnerNearby } from "../movement/index.js";

export type NextTickResult = {
  /** Delay in ms; null = do not schedule (e.g. NPC idle). */
  delayMs: number | null;
  /** When true, caller must call store.setAutonomousSoulTickDue(true). */
  setSoulTickDue?: boolean;
};

/**
 * Pure policy: when should the next tick run?
 * Order matters: immediate follow-up and must_act_build run ASAP; then error recovery;
 * then NPC idle (soul tick when owner away, or no schedule); else fixed interval.
 * Caller must call store.setAutonomousSoulTickDue(true) when result.setSoulTickDue is true.
 */
export function getNextTickDelay(
  state: ClawState,
  config: ClawConfig,
  opts: { needImmediateFollowUp: boolean }
): NextTickResult {
  if (opts.needImmediateFollowUp) return { delayMs: 0 };
  if (state.tickPhase === "must_act_build") return { delayMs: 0 };
  if (state.lastError) return { delayMs: config.tickIntervalMs };

  // NPC-style idle: no periodic LLM until wake. If owner away, schedule soul tick.
  if (config.npcStyleIdle && !state.llmWakePending) {
    const ownerAway =
      config.ownerUserId &&
      config.autonomousSoulTickMs > 0 &&
      state.myPosition &&
      !isOwnerNearby(state, config);
    if (ownerAway) return { delayMs: config.autonomousSoulTickMs, setSoulTickDue: true };
    return { delayMs: null };
  }

  return { delayMs: config.tickIntervalMs };
}

/** Scheduler for the tick loop: guards re-entry, schedules next run, and tracks follow-up requests. */
export type TickScheduler = {
  /** Set the callback invoked when a scheduled tick fires. Call before starting the loop. */
  setTickCallback(cb: () => void): void;
  isTickRunning(): boolean;
  setTickRunning(running: boolean): void;
  /** Schedule next tick in delayMs, or cancel if null. Replaces any existing schedule. */
  scheduleNextTick(delayMs: number | null): void;
  cancelNextTick(): void;
  /** Request that the next tick run immediately after the current one (used when wake occurs mid-tick). */
  requestFollowUp(): void;
  /** Return and clear the follow-up flag (used in .finally() to decide delay). */
  consumeFollowUp(): boolean;
};

/**
 * Create a scheduler for the tick loop. Call setTickCallback with runTickThenScheduleNext
 * before starting the loop. The scheduler does not mutate store; it only coordinates
 * "is tick running," "schedule next," and "request follow-up."
 */
export function createTickScheduler(): TickScheduler {
  let tickInProgress = false;
  let tickScheduledId: ReturnType<typeof setTimeout> | null = null;
  let wakeAfterTick = false;
  let tickCallback: (() => void) | null = null;

  function clearScheduled(): void {
    if (tickScheduledId != null) {
      clearTimeout(tickScheduledId);
      tickScheduledId = null;
    }
  }

  return {
    setTickCallback(cb: () => void) {
      tickCallback = cb;
    },

    isTickRunning() {
      return tickInProgress;
    },

    setTickRunning(running: boolean) {
      tickInProgress = running;
    },

    scheduleNextTick(delayMs: number | null) {
      clearScheduled();
      if (delayMs !== null && tickCallback) {
        tickScheduledId = setTimeout(() => {
          tickScheduledId = null;
          tickCallback!();
        }, delayMs);
      }
    },

    cancelNextTick() {
      clearScheduled();
    },

    requestFollowUp() {
      wakeAfterTick = true;
    },

    consumeFollowUp() {
      const value = wakeAfterTick;
      wakeAfterTick = false;
      return value;
    },
  };
}
