/**
 * Wake API — all "there is work to do" flows through requestWake.
 * Sets store so the next tree tick sees the wake and routes to Obedient or Autonomous.
 * @see docs/PLAN-AGENT-WAKE-DRIVEN.md
 */

import type { ClawStore } from "./state/index.js";
import type { PendingScheduledTask } from "./state/index.js";

/** Source of the wake: DM (owner/guest), autonomous scheduler, or cron. */
export type WakeType = "dm" | "autonomous" | "cron";

export type WakePayload = {
  task?: PendingScheduledTask;
  [k: string]: unknown;
};

/**
 * Enqueue a wake. Next tree tick will run the matching branch (owner/cron → Obedient, else Autonomous).
 * For DM, the chat handler must set lastTriggerUserId and push chat before calling this.
 * For cron, pass payload.task so Obedient can read the scheduled task.
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

/** Request a cron wake with a scheduled task. Tree routes cron to Obedient. */
export function requestCronWake(store: ClawStore, task: PendingScheduledTask): void {
  requestWake(store, "cron", { task });
}
