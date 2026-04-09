/**
 * Wake API — all "there is work to do" flows through requestWake.
 * Sets store so the next tree tick sees the wake and routes to Obedient or Autonomous.
 * @see docs/PLAN-AGENT-WAKE-DRIVEN.md
 */

import type { ClawConfig } from "./config/index.js";
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

/** True when the pending wake is for the owner DM or a scheduled task (Obedient branch). */
function isOwnerOrCronWakePending(store: ClawStore, config: ClawConfig): boolean {
  const s = store.getState();
  if (!s.wakePending) return false;
  const isOwner = config.ownerUserId != null && s.lastTriggerUserId === config.ownerUserId;
  return isOwner || s.pendingScheduledTask != null;
}

/**
 * Enqueue an autonomous tree tick without waiting for the soul timer.
 * Does not override a pending owner or cron wake. No-op for builder agents.
 */
export function requestAutonomousWakeNow(store: ClawStore, config: ClawConfig): void {
  if (config.agentType === "builder") return;
  if (isOwnerOrCronWakePending(store, config)) return;
  store.setWakePending(true);
  store.setLastTriggerUserId(null);
}
