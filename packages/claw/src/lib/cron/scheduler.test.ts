import { describe, it, expect, vi, afterEach } from "vitest";
import { startCronScheduler } from "./scheduler.js";
import { createClawStore } from "../state/index.js";

describe("startCronScheduler", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls requestCronWake when task is due (intervalMs elapsed)", () => {
    vi.useFakeTimers();
    const store = createClawStore("0_0");
    store.clearWake();
    store.clearPendingScheduledTask();
    const getTasks = () => [
      { taskId: "remind", instruction: "Remind user", intervalMs: 100 },
    ];
    const { stop } = startCronScheduler(store, getTasks, { checkIntervalMs: 50 });
    expect(store.getState().wakePending).toBe(false);
    vi.advanceTimersByTime(50);
    expect(store.getState().wakePending).toBe(true);
    expect(store.getState().pendingScheduledTask).toEqual({
      taskId: "remind",
      instruction: "Remind user",
    });
    stop();
  });

  it("skips tasks with no intervalMs", () => {
    vi.useFakeTimers();
    const store = createClawStore("0_0");
    store.clearWake();
    const getTasks = () => [
      { taskId: "no-interval", instruction: "Skip me" },
    ];
    startCronScheduler(store, getTasks, { checkIntervalMs: 50 });
    vi.advanceTimersByTime(100);
    expect(store.getState().wakePending).toBe(false);
  });

  it("stop clears interval", () => {
    vi.useFakeTimers();
    const store = createClawStore("0_0");
    store.clearWake();
    const getTasks = () => [{ taskId: "t", instruction: "Run", intervalMs: 10 }];
    const { stop } = startCronScheduler(store, getTasks, { checkIntervalMs: 5 });
    stop();
    vi.advanceTimersByTime(100);
    expect(store.getState().wakePending).toBe(false);
  });
});
