import { describe, it, expect } from "vitest";
import { createTreeAgent } from "./agent.js";
import { createClawStore } from "../state/index.js";
import { testConfig } from "../testHelpers.js";

function createTestContext(overrides?: { ownerUserId?: string | null; hosted?: boolean }) {
  const store = createClawStore("0_0");
  const config = testConfig(overrides);
  return { store, config };
}

describe("createTreeAgent", () => {
  describe("HasOwnerWake", () => {
    it("returns true when wakePending and lastTriggerUserId is owner", () => {
      const { store, config } = createTestContext({ ownerUserId: "owner-1" });
      store.setWakePending(true);
      store.setLastTriggerUserId("owner-1");
      const agent = createTreeAgent({ store, config });
      expect(agent.HasOwnerWake()).toBe(true);
    });

    it("returns false when wakePending but lastTriggerUserId is not owner", () => {
      const { store, config } = createTestContext({ ownerUserId: "owner-1" });
      store.setWakePending(true);
      store.setLastTriggerUserId("other-user");
      const agent = createTreeAgent({ store, config });
      expect(agent.HasOwnerWake()).toBe(false);
    });

    it("returns true when wakePending and pendingScheduledTask is set", () => {
      const { store, config } = createTestContext();
      store.setWakePending(true);
      store.setPendingScheduledTask({ taskId: "t1", instruction: "Do something" });
      const agent = createTreeAgent({ store, config });
      expect(agent.HasOwnerWake()).toBe(true);
    });

    it("returns false when not wakePending", () => {
      const { store, config } = createTestContext({ ownerUserId: "owner-1" });
      store.clearWake();
      store.setLastTriggerUserId("owner-1");
      const agent = createTreeAgent({ store, config });
      expect(agent.HasOwnerWake()).toBe(false);
    });
  });

  describe("HasEnoughCredits", () => {
    it("returns true when not hosted", () => {
      const { store, config } = createTestContext({ hosted: false });
      store.setState({ cachedBalance: 0 });
      const agent = createTreeAgent({ store, config });
      expect(agent.HasEnoughCredits()).toBe(true);
    });

    it("returns false when hosted and balance below threshold", () => {
      const { store, config } = createTestContext({
        hosted: true,
        skipCreditReport: false,
      });
      store.setState({ cachedBalance: 0, dailySpend: 0 });
      const agent = createTreeAgent({ store, config });
      expect(agent.HasEnoughCredits()).toBe(false);
    });
  });

  describe("ClearWakeIdle", () => {
    it("clears wake and returns SUCCEEDED", async () => {
      const { store, config } = createTestContext();
      store.setWakePending(true);
      const agent = createTreeAgent({ store, config });
      const { State } = await import("mistreevous");
      expect(agent.ClearWakeIdle()).toBe(State.SUCCEEDED);
      expect(store.getState().wakePending).toBe(false);
    });
  });
});
