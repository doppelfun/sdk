import { describe, it, expect } from "vitest";
import { isUuid } from "./uuid.js";

describe("isUuid", () => {
  it("returns true for valid UUID", () => {
    expect(isUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isUuid("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBe(true);
  });

  it("returns true for UUID with leading/trailing spaces (trimmed)", () => {
    expect(isUuid("  550e8400-e29b-41d4-a716-446655440000  ")).toBe(true);
  });

  it("returns false for non-UUID strings", () => {
    expect(isUuid("")).toBe(false);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid("550e8400-e29b-41d4-a716")).toBe(false);
    expect(isUuid("doc-123")).toBe(false);
  });
});
