/**
 * Request-wake API: all "there is work to do" goes through requestWake.
 * Sets store so the next tree tick sees the wake and routes to Obedient or Autonomous.
 * @see docs/PLAN-AGENT-WAKE-DRIVEN.md
 */

import type { ClawStore } from "./state/index.js";
import type { PendingScheduledTask } from "./state/index.js";

export type WakeType = "dm" | "autonomous" | "cron";

export type WakePayload = {
  task?: PendingScheduledTask;
  [k: string]: unknown;
};

/**
 * Enqueue a wake. For DM, the chat handler should set lastTriggerUserId and push chat before this.
 * For cron, payload.task is stored as pendingScheduledTask so Obedient can see it.
 */
export function requestWake(
  store: ClawStore,
  type: WakeType,
  payload?: WakePayload
): void {
  store.setWakePending(true);
  if (type === "cron" && payload?.task) {
    store.setPendingScheduledTask(payload.task as PendingScheduledTask);
  }
}

/** Convenience: request a cron wake with a scheduled task. Tree routes owner/cron to Obedient. */
export function requestCronWake(store: ClawStore, task: PendingScheduledTask): void {
  requestWake(store, "cron", { task });
}
