import { describe, it, expect } from "vitest";
import {
  moveSchema,
  chatSchema,
  getToolSchema,
  CLAW_TOOL_REGISTRY,
  generateProceduralSchema,
} from "./toolsZod.js";

describe("toolsZod", () => {
  it("moveSchema accepts numbers", () => {
    const r = moveSchema.safeParse({ moveX: 0.2, moveZ: -0.1 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.moveX).toBe(0.2);
  });

  it("moveSchema rejects string moveX (executeTool would coerce; Zod catches bad model output)", () => {
    const r = moveSchema.safeParse({ moveX: "0.2", moveZ: 0 });
    expect(r.success).toBe(false);
  });

  it("chatSchema requires text", () => {
    expect(chatSchema.safeParse({}).success).toBe(false);
    expect(chatSchema.safeParse({ text: "hi" }).success).toBe(true);
  });

  it("getToolSchema returns schema by name", () => {
    expect(getToolSchema("move")).toBe(moveSchema);
    expect(getToolSchema("nonexistent")).toBeUndefined();
  });

  it("generateProceduralSchema normalizes procedural-city to city", () => {
    const r = generateProceduralSchema.safeParse({ kind: "procedural-city", params: {} });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.kind).toBe("city");
  });

  it("generateProceduralSchema rejects unknown kind at parse", () => {
    const r = generateProceduralSchema.safeParse({ kind: "skyscraper" });
    expect(r.success).toBe(false);
  });

  it("CLAW_TOOL_REGISTRY has unique names", () => {
    const names = CLAW_TOOL_REGISTRY.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("chat");
    expect(names).toContain("build_full");
    expect(names).toContain("list_catalog");
  });
});
