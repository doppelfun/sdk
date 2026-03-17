import { describe, it, expect } from "vitest";
import { hasEnoughCredits, MIN_BALANCE_THRESHOLD } from "./usage.js";
import { createClawStore } from "../state/index.js";
import { testConfig } from "../../util/testHelpers.js";

describe("hasEnoughCredits", () => {
  it("returns true when not hosted", () => {
    const store = createClawStore("0_0");
    const config = testConfig({ hosted: false });
    store.setState({ cachedBalance: 0, dailySpend: 0 });
    expect(hasEnoughCredits(store, config)).toBe(true);
  });

  it("returns true when skipCreditReport", () => {
    const store = createClawStore("0_0");
    const config = testConfig({ hosted: true, skipCreditReport: true });
    store.setState({ cachedBalance: 0 });
    expect(hasEnoughCredits(store, config)).toBe(true);
  });

  it("returns false when hosted and cachedBalance below threshold", () => {
    const store = createClawStore("0_0");
    const config = testConfig({ hosted: true, skipCreditReport: false });
    store.setState({ cachedBalance: MIN_BALANCE_THRESHOLD - 0.01, dailySpend: 0 });
    expect(hasEnoughCredits(store, config)).toBe(false);
  });

  it("returns true when hosted and cachedBalance at or above threshold", () => {
    const store = createClawStore("0_0");
    const config = testConfig({ hosted: true, skipCreditReport: false });
    store.setState({ cachedBalance: MIN_BALANCE_THRESHOLD, dailySpend: 0 });
    expect(hasEnoughCredits(store, config)).toBe(true);
  });

  it("returns false when dailySpend >= dailyCreditBudget", () => {
    const store = createClawStore("0_0");
    const config = testConfig({ hosted: true, skipCreditReport: false, dailyCreditBudget: 10 });
    store.setState({ cachedBalance: 100, dailySpend: 10 });
    expect(hasEnoughCredits(store, config)).toBe(false);
  });
});
