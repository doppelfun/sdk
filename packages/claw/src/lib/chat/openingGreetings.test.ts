import { describe, it, expect } from "vitest";
import {
  AUTONOMOUS_OPENING_GREETINGS,
  pickAutonomousOpeningGreeting,
  matchesStockOpeningGreeting,
} from "./openingGreetings.js";
import { isGreeting } from "../conversation.js";

describe("openingGreetings", () => {
  it("pickAutonomousOpeningGreeting returns only known lines", () => {
    for (let i = 0; i < 30; i++) {
      expect(AUTONOMOUS_OPENING_GREETINGS).toContain(pickAutonomousOpeningGreeting());
    }
  });

  it("matchesStockOpeningGreeting normalizes punctuation", () => {
    expect(matchesStockOpeningGreeting("Hi!")).toBe(true);
    expect(matchesStockOpeningGreeting("Nice to run into you")).toBe(true);
    expect(matchesStockOpeningGreeting("not a stock line")).toBe(false);
  });

  it("isGreeting recognizes stock autonomous lines", () => {
    expect(isGreeting("How's it going?")).toBe(true);
    expect(isGreeting("Hey — good to see you!")).toBe(true);
  });
});
