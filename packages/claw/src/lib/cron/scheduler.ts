/**
 * Simple cron-style scheduler: periodically check tasks and call requestCronWake when due.
 * Uses intervalMs per task (last run + intervalMs <= now). Profile cronTasks can set intervalMs or we derive from schedule.
 */
import type { ClawStore } from "../state/index.js";
import { requestCronWake } from "../../wake.js";
import type { PendingScheduledTask } from "../state/index.js";

export type CronTaskDef = {
  taskId: string;
  instruction: string;
  /** Run every N ms. If omitted, task is skipped by this scheduler. */
  intervalMs?: number;
  [k: string]: unknown;
};

const DEFAULT_CHECK_MS = 60_000;

export type CronSchedulerOptions = {
  /** How often to check for due tasks (ms). Default 60s. */
  checkIntervalMs?: number;
};

/**
 * Start a scheduler that calls getTasks() every checkIntervalMs and, for each task with intervalMs,
 * fires requestCronWake(store, task) when lastRun + intervalMs <= now.
 * Returns stop() to clear the interval.
 */
export function startCronScheduler(
  store: ClawStore,
  getTasks: () => CronTaskDef[],
  options: CronSchedulerOptions = {}
): { stop: () => void } {
  const checkIntervalMs = options.checkIntervalMs ?? DEFAULT_CHECK_MS;
  const lastRun = new Map<string, number>();

  const tick = (): void => {
    const now = Date.now();
    const tasks = getTasks();
    for (const task of tasks) {
      const intervalMs = task.intervalMs ?? 0;
      if (intervalMs <= 0) continue;
      const key = task.taskId;
      const last = lastRun.get(key) ?? 0;
      if (now - last >= intervalMs) {
        const payload: PendingScheduledTask = { taskId: task.taskId, instruction: task.instruction };
        requestCronWake(store, payload);
        lastRun.set(key, now);
      }
    }
  };

  const id = setInterval(tick, checkIntervalMs);
  return {
    stop() {
      clearInterval(id);
      lastRun.clear();
    },
  };
}
