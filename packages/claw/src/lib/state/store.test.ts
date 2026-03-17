import { describe, it, expect } from "vitest";
import { createClawStore } from "./store.js";

describe("createClawStore document actions", () => {
  it("mergeDocumentsByBlockSlot sets document for block", () => {
    const store = createClawStore("0_0");
    store.mergeDocumentsByBlockSlot("0_0", { documentId: "doc-1", mml: "<m-group/>" });
    expect(store.getState().documentsByBlockSlot["0_0"]).toEqual({
      documentId: "doc-1",
      mml: "<m-group/>",
    });
  });

  it("setDocumentsByBlockSlot(null) removes block doc", () => {
    const store = createClawStore("0_0");
    store.mergeDocumentsByBlockSlot("0_0", { documentId: "doc-1", mml: "" });
    store.setDocumentsByBlockSlot("0_0", null);
    expect(store.getState().documentsByBlockSlot["0_0"]).toBeUndefined();
  });

  it("setLastDocumentsList and setLastCatalogContext update cache", () => {
    const store = createClawStore("0_0");
    expect(store.getState().lastDocumentsList).toBeNull();
    expect(store.getState().lastCatalogContext).toBeNull();
    store.setLastDocumentsList("3 document(s): a, b, c");
    store.setLastCatalogContext("10 entries...");
    expect(store.getState().lastDocumentsList).toBe("3 document(s): a, b, c");
    expect(store.getState().lastCatalogContext).toBe("10 entries...");
  });
});
