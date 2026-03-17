import { describe, it, expect } from "vitest";
import { isDocumentIdUuid, DOCUMENT_ID_UUID_HINT, cacheDocumentsList } from "./documents.js";
import { createClawStore } from "../state/index.js";

describe("isDocumentIdUuid", () => {
  it("returns true for valid UUID", () => {
    expect(isDocumentIdUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  it("returns false for filename-like strings", () => {
    expect(isDocumentIdUuid("scene.mml")).toBe(false);
    expect(isDocumentIdUuid("doc-1")).toBe(false);
  });
});

describe("DOCUMENT_ID_UUID_HINT", () => {
  it("is a non-empty string", () => {
    expect(typeof DOCUMENT_ID_UUID_HINT).toBe("string");
    expect(DOCUMENT_ID_UUID_HINT.length).toBeGreaterThan(0);
  });
});

describe("cacheDocumentsList", () => {
  it("updates store and returns summary for empty list", () => {
    const store = createClawStore("0_0");
    const { summaryForTool } = cacheDocumentsList(store, []);
    expect(summaryForTool).toBe("0 documents");
    expect(store.getState().lastDocumentsList).toBe("0 documents");
  });

  it("updates store and returns summary for non-empty list", () => {
    const store = createClawStore("0_0");
    const ids = ["id-1", "id-2"];
    const { summaryForTool } = cacheDocumentsList(store, ids);
    expect(summaryForTool).toBe("2 document(s): id-1, id-2");
    expect(store.getState().lastDocumentsList).toBe("2 document(s): id-1, id-2");
  });
});
