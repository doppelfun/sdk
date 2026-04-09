import { describe, it, expect } from "vitest";
import { requestWake, requestCronWake, requestAutonomousWakeNow } from "./wake.js";
import { createClawStore } from "./state/index.js";
import type { PendingScheduledTask } from "./state/index.js";
import { testConfig } from "../util/testHelpers.js";

describe("requestWake", () => {
  it("sets wakePending true", () => {
    const store = createClawStore("0_0");
    store.clearWake();
    expect(store.getState().wakePending).toBe(false);
    requestWake(store, "dm");
    expect(store.getState().wakePending).toBe(true);
  });

  it("stores pendingScheduledTask when type is cron and payload has task", () => {
    const store = createClawStore("0_0");
    const task: PendingScheduledTask = { taskId: "t1", instruction: "Say hello" };
    requestWake(store, "cron", { task });
    expect(store.getState().wakePending).toBe(true);
    expect(store.getState().pendingScheduledTask).toEqual(task);
  });

  it("does not set pendingScheduledTask for dm wake", () => {
    const store = createClawStore("0_0");
    store.setPendingScheduledTask(null);
    requestWake(store, "dm");
    expect(store.getState().pendingScheduledTask).toBeNull();
  });
});

describe("requestCronWake", () => {
  it("sets wakePending and pendingScheduledTask", () => {
    const store = createClawStore("0_0");
    store.clearWake();
    store.clearPendingScheduledTask();
    const task: PendingScheduledTask = { taskId: "t2", instruction: "Remind user" };
    requestCronWake(store, task);
    expect(store.getState().wakePending).toBe(true);
    expect(store.getState().pendingScheduledTask).toEqual(task);
  });
});

describe("requestAutonomousWakeNow", () => {
  it("sets wake and clears lastTriggerUserId for companion when no owner/cron wake", () => {
    const store = createClawStore("0_0");
    store.setState({ wakePending: false, lastTriggerUserId: "guest-1" });
    requestAutonomousWakeNow(store, testConfig({ agentType: "companion", ownerUserId: "owner-1" }));
    expect(store.getState().wakePending).toBe(true);
    expect(store.getState().lastTriggerUserId).toBeNull();
  });

  it("no-ops for builder", () => {
    const store = createClawStore("0_0");
    store.setState({ wakePending: false, lastTriggerUserId: null });
    requestAutonomousWakeNow(store, testConfig({ agentType: "builder" }));
    expect(store.getState().wakePending).toBe(false);
  });

  it("does not clear owner-pending wake", () => {
    const store = createClawStore("0_0");
    store.setState({ wakePending: true, lastTriggerUserId: "owner-1" });
    requestAutonomousWakeNow(store, testConfig({ agentType: "companion", ownerUserId: "owner-1" }));
    expect(store.getState().lastTriggerUserId).toBe("owner-1");
  });
});
