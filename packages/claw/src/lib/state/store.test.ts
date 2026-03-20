import { describe, it, expect } from "vitest";
import { createClawStore } from "./store.js";
import { isAgentRunningLlm, isAgentInError } from "./state.js";

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

describe("isAgentRunningLlm", () => {
  it("returns true when currentAction is obedient or autonomous_llm", () => {
    const store = createClawStore("0_0");
    store.setState({ currentAction: "idle" });
    expect(isAgentRunningLlm(store.getState())).toBe(false);
    store.setState({ currentAction: "obedient" });
    expect(isAgentRunningLlm(store.getState())).toBe(true);
    store.setState({ currentAction: "autonomous_llm" });
    expect(isAgentRunningLlm(store.getState())).toBe(true);
    store.setState({ currentAction: "movement_only" });
    expect(isAgentRunningLlm(store.getState())).toBe(false);
  });
});

describe("isThinking", () => {
  it("defaults to false and can be set by store", () => {
    const store = createClawStore("0_0");
    expect(store.getState().isThinking).toBe(false);
    store.setThinking(true);
    expect(store.getState().isThinking).toBe(true);
    store.setThinking(false);
    expect(store.getState().isThinking).toBe(false);
  });
});

describe("isAgentInError", () => {
  it("returns true only when currentAction is error", () => {
    const store = createClawStore("0_0");
    store.setState({ currentAction: "idle" });
    expect(isAgentInError(store.getState())).toBe(false);
    store.setState({ currentAction: "error" });
    expect(isAgentInError(store.getState())).toBe(true);
    store.setState({ currentAction: "obedient" });
    expect(isAgentInError(store.getState())).toBe(false);
  });
});
