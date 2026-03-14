import { describe, it, expect } from "vitest";
import { createClawStore } from "../state/index.js";
import { computeTickIntent, ownerBuildBlocked } from "./tickRunner.js";
import { testConfig } from "./testHelpers.js";

describe("computeTickIntent", () => {
  it("returns idle_skip when must_act_build and pendingBuildTicks > 4", () => {
    const store = createClawStore("0_0");
    store.setState({
      tickPhase: "must_act_build",
      pendingBuildTicks: 5,
      pendingBuildKind: null,
    });
    const config = testConfig();
    const intent = computeTickIntent(store.getState(), config);
    expect(intent.kind).toBe("idle_skip");
  });

  it("returns idle_skip when must_act_build and ownerBuildBlocked", () => {
    const store = createClawStore("0_0");
    store.setState({
      tickPhase: "must_act_build",
      pendingBuildTicks: 1,
      pendingBuildKind: null,
      lastTriggerUserId: "other-user",
    });
    const config = testConfig({ hosted: true, ownerUserId: "owner-1" });
    const intent = computeTickIntent(store.getState(), config);
    expect(intent.kind).toBe("idle_skip");
  });

  it("returns build_procedural when must_act_build and pendingBuildKind is city", () => {
    const store = createClawStore("0_0");
    store.setState({
      tickPhase: "must_act_build",
      pendingBuildTicks: 1,
      pendingBuildKind: "city",
    });
    const config = testConfig();
    const intent = computeTickIntent(store.getState(), config);
    expect(intent.kind).toBe("build_procedural");
    expect(intent.proceduralKind).toBe("city");
  });

  it("returns build_procedural when must_act_build and pendingBuildKind is pyramid", () => {
    const store = createClawStore("0_0");
    store.setState({
      tickPhase: "must_act_build",
      pendingBuildTicks: 1,
      pendingBuildKind: "pyramid",
    });
    const config = testConfig();
    const intent = computeTickIntent(store.getState(), config);
    expect(intent.kind).toBe("build_procedural");
    expect(intent.proceduralKind).toBe("pyramid");
  });

  it("returns build_llm when must_act_build, no procedural kind, not over max, not blocked", () => {
    const store = createClawStore("0_0");
    store.setState({
      tickPhase: "must_act_build",
      pendingBuildTicks: 1,
      pendingBuildKind: null,
    });
    const config = testConfig();
    const intent = computeTickIntent(store.getState(), config);
    expect(intent.kind).toBe("build_llm");
  });

  it("returns idle_skip when idle, no wake, no error, no soul tick", () => {
    const store = createClawStore("0_0");
    store.setState({
      tickPhase: "idle",
      llmWakePending: false,
      lastError: null,
      autonomousSoulTickDue: false,
    });
    const config = testConfig();
    const intent = computeTickIntent(store.getState(), config);
    expect(intent.kind).toBe("idle_skip");
  });

  it("returns llm_tick when llmWakePending", () => {
    const store = createClawStore("0_0");
    store.setState({
      tickPhase: "idle",
      llmWakePending: true,
      autonomousSoulTickDue: false,
    });
    const config = testConfig();
    const intent = computeTickIntent(store.getState(), config);
    expect(intent.kind).toBe("llm_tick");
    expect(intent.soulTick).toBeFalsy();
  });

  it("returns llm_tick with soulTick when autonomousSoulTickDue and owner away", () => {
    const store = createClawStore("0_0");
    store.setState({
      tickPhase: "idle",
      llmWakePending: false,
      lastError: null,
      autonomousSoulTickDue: true,
      myPosition: { x: 0, y: 0, z: 0 },
      occupants: [], // owner not in list => away
    });
    const config = testConfig({ ownerUserId: "owner-1", autonomousSoulTickMs: 45000 });
    const intent = computeTickIntent(store.getState(), config);
    expect(intent.kind).toBe("llm_tick");
    expect(intent.soulTick).toBe(true);
  });

  it("returns idle_skip when autonomousSoulTickDue but owner nearby (no other wake)", () => {
    const store = createClawStore("0_0");
    store.setState({
      tickPhase: "idle",
      llmWakePending: false,
      lastError: null,
      autonomousSoulTickDue: true,
      myPosition: { x: 0, y: 0, z: 0 },
      occupants: [
        { userId: "owner-1", type: "user", clientId: "c1", username: "Owner", position: { x: 0, y: 0, z: 0 } },
      ],
    });
    const config = testConfig({ ownerUserId: "owner-1" });
    const intent = computeTickIntent(store.getState(), config);
    // Owner nearby => soul tick not applied => no wake => skip
    expect(intent.kind).toBe("idle_skip");
  });
});

describe("ownerBuildBlocked", () => {
  it("returns false when not hosted", () => {
    const store = createClawStore("0_0");
    store.setState({ lastTriggerUserId: "other" });
    const config = testConfig({ hosted: false, ownerUserId: "owner-1" });
    expect(ownerBuildBlocked(config, store.getState())).toBe(false);
  });

  it("returns false when no ownerUserId", () => {
    const store = createClawStore("0_0");
    const config = testConfig({ hosted: true, ownerUserId: null });
    expect(ownerBuildBlocked(config, store.getState())).toBe(false);
  });

  it("returns true when hosted, owner set, last trigger was not owner", () => {
    const store = createClawStore("0_0");
    store.setState({ lastTriggerUserId: "other-user" });
    const config = testConfig({ hosted: true, ownerUserId: "owner-1" });
    expect(ownerBuildBlocked(config, store.getState())).toBe(true);
  });

  it("returns false when hosted, owner set, last trigger was owner", () => {
    const store = createClawStore("0_0");
    store.setState({ lastTriggerUserId: "owner-1" });
    const config = testConfig({ hosted: true, ownerUserId: "owner-1" });
    expect(ownerBuildBlocked(config, store.getState())).toBe(false);
  });
});
