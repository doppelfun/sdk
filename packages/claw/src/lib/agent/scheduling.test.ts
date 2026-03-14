import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClawStore } from "../state/index.js";
import { getNextTickDelay, createTickScheduler } from "./scheduling.js";
import { testConfig } from "./testHelpers.js";

describe("getNextTickDelay", () => {
  it("returns 0 when needImmediateFollowUp is true", () => {
    const store = createClawStore("0_0");
    const config = testConfig();
    const result = getNextTickDelay(store.getState(), config, {
      needImmediateFollowUp: true,
    });
    expect(result.delayMs).toBe(0);
    expect(result.setSoulTickDue).toBeUndefined();
  });

  it("returns 0 when tickPhase is must_act_build", () => {
    const store = createClawStore("0_0");
    store.setState({ tickPhase: "must_act_build" });
    const config = testConfig();
    const result = getNextTickDelay(store.getState(), config, {
      needImmediateFollowUp: false,
    });
    expect(result.delayMs).toBe(0);
  });

  it("returns tickIntervalMs when lastError is set", () => {
    const store = createClawStore("0_0");
    store.setLastError("error", "msg");
    const config = testConfig({ tickIntervalMs: 3000 });
    const result = getNextTickDelay(store.getState(), config, {
      needImmediateFollowUp: false,
    });
    expect(result.delayMs).toBe(3000);
  });

  it("returns null when npcStyleIdle, no wake, owner nearby (no soul tick)", () => {
    const store = createClawStore("0_0");
    store.setState({
      llmWakePending: false,
      lastError: null,
      myPosition: { x: 0, y: 0, z: 0 },
      occupants: [{ userId: "owner-1", type: "user", clientId: "c1", position: { x: 0, y: 0, z: 0 } }],
    });
    const config = testConfig({ ownerUserId: "owner-1", autonomousSoulTickMs: 45000 });
    const result = getNextTickDelay(store.getState(), config, {
      needImmediateFollowUp: false,
    });
    expect(result.delayMs).toBeNull();
    expect(result.setSoulTickDue).toBeUndefined();
  });

  it("returns autonomousSoulTickMs and setSoulTickDue when npcStyleIdle, no wake, owner away", () => {
    const store = createClawStore("0_0");
    store.setState({
      llmWakePending: false,
      lastError: null,
      myPosition: { x: 0, y: 0, z: 0 },
      occupants: [], // owner not in occupants => away
    });
    const config = testConfig({
      ownerUserId: "owner-1",
      autonomousSoulTickMs: 45000,
    });
    const result = getNextTickDelay(store.getState(), config, {
      needImmediateFollowUp: false,
    });
    expect(result.delayMs).toBe(45000);
    expect(result.setSoulTickDue).toBe(true);
  });

  it("returns tickIntervalMs when !npcStyleIdle", () => {
    const store = createClawStore("0_0");
    store.setState({ llmWakePending: false });
    const config = testConfig({ npcStyleIdle: false });
    const result = getNextTickDelay(store.getState(), config, {
      needImmediateFollowUp: false,
    });
    expect(result.delayMs).toBe(5000);
  });

  it("returns tickIntervalMs when npcStyleIdle but llmWakePending is true", () => {
    const store = createClawStore("0_0");
    store.setState({ llmWakePending: true });
    const config = testConfig({ npcStyleIdle: true });
    const result = getNextTickDelay(store.getState(), config, {
      needImmediateFollowUp: false,
    });
    expect(result.delayMs).toBe(5000);
  });
});

describe("TickScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("scheduleNextTick clears previous timeout", () => {
    const scheduler = createTickScheduler();
    const cb = vi.fn();
    scheduler.setTickCallback(cb);
    scheduler.scheduleNextTick(1000);
    scheduler.scheduleNextTick(2000);
    vi.advanceTimersByTime(1000);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("consumeFollowUp returns and clears flag", () => {
    const scheduler = createTickScheduler();
    expect(scheduler.consumeFollowUp()).toBe(false);
    scheduler.requestFollowUp();
    expect(scheduler.consumeFollowUp()).toBe(true);
    expect(scheduler.consumeFollowUp()).toBe(false);
  });

  it("cancelNextTick clears scheduled callback", () => {
    const scheduler = createTickScheduler();
    const cb = vi.fn();
    scheduler.setTickCallback(cb);
    scheduler.scheduleNextTick(1000);
    scheduler.cancelNextTick();
    vi.advanceTimersByTime(2000);
    expect(cb).not.toHaveBeenCalled();
  });
});
