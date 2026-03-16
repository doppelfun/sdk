import { describe, it, expect } from "vitest";
import { isBuildCompletionSummary, RUN_BUILD_STUB_MESSAGE } from "./runBuildTool.js";

describe("isBuildCompletionSummary", () => {
  it("returns true for built summary", () => {
    expect(isBuildCompletionSummary("Built a city at 50,50")).toBe(true);
    expect(isBuildCompletionSummary("build completed")).toBe(true);
    expect(isBuildCompletionSummary("Build done.")).toBe(true);
    expect(isBuildCompletionSummary("Build finished")).toBe(true);
  });

  it("returns true for failed/error summary", () => {
    expect(isBuildCompletionSummary("Build failed")).toBe(true);
    expect(isBuildCompletionSummary("error: something went wrong")).toBe(true);
  });

  it("returns false for follow-up questions", () => {
    expect(isBuildCompletionSummary("Do you want a premade or custom build?")).toBe(false);
    expect(isBuildCompletionSummary("What size would you like?")).toBe(false);
  });
});

describe("RUN_BUILD_STUB_MESSAGE", () => {
  it("is the autonomous stub message", () => {
    expect(RUN_BUILD_STUB_MESSAGE).toContain("not available");
  });
});
