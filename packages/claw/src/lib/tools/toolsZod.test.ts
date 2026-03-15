import { describe, it, expect } from "vitest";
import { runProceduralMml } from "@doppelfun/gen";
import {
  approachPositionSchema,
  approachPersonSchema,
  stopSchema,
  chatSchema,
  getToolSchema,
  CLAW_TOOL_REGISTRY,
  generateProceduralSchema,
  buildFullSchema,
} from "./toolsZod.js";

describe("toolsZod", () => {
  it("approachPositionSchema accepts position", () => {
    const r = approachPositionSchema.safeParse({ position: "50,50" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.position).toBe("50,50");
  });

  it("approachPersonSchema accepts sessionId", () => {
    const r = approachPersonSchema.safeParse({ sessionId: "abc123" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.sessionId).toBe("abc123");
  });

  it("stopSchema accepts empty", () => {
    const r = stopSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it("buildFullSchema rejects non-UUID documentId", () => {
    const r = buildFullSchema.safeParse({
      instruction: "build a cube",
      documentId: "spaceship_build.mml",
    });
    expect(r.success).toBe(false);
  });

  it("buildFullSchema accepts UUID documentId for replace flows", () => {
    const r = buildFullSchema.safeParse({
      instruction: "build a cube",
      documentTarget: "replace_current",
      documentId: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(r.success).toBe(true);
  });

  it("chatSchema requires text", () => {
    expect(chatSchema.safeParse({}).success).toBe(false);
    expect(chatSchema.safeParse({ text: "hi" }).success).toBe(true);
  });

  it("getToolSchema returns schema by name", () => {
    expect(getToolSchema("approach_position")).toBe(approachPositionSchema);
    expect(getToolSchema("approach_person")).toBe(approachPersonSchema);
    expect(getToolSchema("stop")).toBe(stopSchema);
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

  it("generateProceduralSchema accepts grass and trees kinds", () => {
    expect(generateProceduralSchema.safeParse({ kind: "grass", params: {} }).success).toBe(true);
    expect(generateProceduralSchema.safeParse({ kind: "trees", params: { count: 5 } }).success).toBe(
      true
    );
  });

  it("generateProceduralSchema accepts pyramid params with cornerColors array", () => {
    const r = generateProceduralSchema.safeParse({
      kind: "pyramid",
      params: {
        baseWidth: 12,
        layers: 3,
        blockSize: 2,
        cornerColors: ["#ff3355", "#33ff88", "#3388ff", "#ffaa00"],
        cornerEmissionIntensity: 5,
      },
    });
    expect(r.success).toBe(true);
  });

  it("runProceduralMml pyramid with cornerColors emits those colors in MML", () => {
    const mml = runProceduralMml("pyramid", {
      kind: "pyramid",
      params: {
        baseWidth: 12,
        layers: 3,
        blockSize: 2,
        doorWidthBlocks: 1,
        seed: 1,
        cornerColors: ["#ff3355", "#33ff88"],
        cornerEmissionIntensity: 4,
      },
    });
    expect(mml).toContain("#ff3355");
    expect(mml).toContain("#33ff88");
    expect(mml).toMatch(/emission-intensity="4(\.00)?"/);
  });

  it("CLAW_TOOL_REGISTRY has unique names", () => {
    const names = CLAW_TOOL_REGISTRY.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("chat");
    expect(names).toContain("build_full");
    expect(names).toContain("list_catalog");
  });
});
