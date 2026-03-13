/**
 * Zustand store for claw agent state.
 *
 * One store per agent run (created in agent bootstrap). All reads go through getState(),
 * all writes through setState() or the actions below. Uses zustand/vanilla (no React).
 */

import { createStore } from "zustand/vanilla";
import type { Occupant } from "@doppelfun/sdk";
import {
  createInitialState,
  computeMainDocumentForBlock,
  type ClawState,
  type ChatEntry,
  type BlockDocument,
  type TickPhase,
  type BuildTarget,
} from "./state.js";

export type ClawStore = ReturnType<typeof createClawStore>;

/** Minimal store API for conversation module: getState + setState only. */
export type ClawStoreApi = {
  getState: () => ClawState;
  setState: (
    partial: Partial<ClawState> | ((s: ClawState) => Partial<ClawState>)
  ) => void;
};

function createClawStore(blockSlotId: string) {
  const vanillaStore = createStore<ClawState>(() => createInitialState(blockSlotId));
  const getState = vanillaStore.getState;
  const setState = vanillaStore.setState;

  const store = {
    getState,
    setState,

    // --- Chat / owner ---
    pushChat(entry: ChatEntry, max: number) {
      setState((s) => ({
        chat: [...s.chat, entry].slice(-max),
      }));
    },

    pushOwnerMessage(text: string, max: number) {
      setState((s) => ({
        ownerMessages: [...s.ownerMessages, { text, at: Date.now() }].slice(
          -max
        ),
      }));
    },

    // --- Errors ---
    setLastError(code: string, message: string, blockSlotId?: string) {
      setState({
        lastError: { code, message, blockSlotId },
        llmWakePending: true,
        errorReplyPending: true,
      });
    },

    clearLastError() {
      setState({ lastError: null, errorReplyPending: false });
    },

    syncMainDocumentForBlock() {
      setState((s) => computeMainDocumentForBlock(s));
    },

    /** Reset state for join_block: slot, clear error/movement/docs/caches. Caller must clearConversation(store, { skipSeekCooldown: true }). */
    resetForJoinBlock(blockSlotId: string) {
      setState({
        blockSlotId,
        lastError: null,
        myPosition: null,
        lastBuildTarget: null,
        movementTarget: null,
        movementIntent: null,
        pendingGoTalkToAgent: null,
        autonomousSeekCooldownUntil: 0,
        lastToolRun: null,
        lastCatalogContext: null,
        lastDocumentsList: null,
        lastOccupantsSummary: null,
      });
      store.syncMainDocumentForBlock();
    },

    // --- Core identity / occupants ---
    setBlockSlotId(slot: string) {
      setState({ blockSlotId: slot });
    },

    setMySessionId(sessionId: string | null) {
      setState({ mySessionId: sessionId });
    },

    setOccupants(list: Occupant[], mySessionId: string | null) {
      const self = list.find((o) => o.clientId === mySessionId);
      setState({ occupants: list, myPosition: self?.position ?? null });
    },

    // --- Tick / build phase ---
    setTickPhase(phase: TickPhase) {
      setState({ tickPhase: phase });
    },

    setPendingBuildKind(kind: "city" | "pyramid" | null) {
      setState({ pendingBuildKind: kind });
    },

    setPendingBuildTicks(ticks: number) {
      setState({ pendingBuildTicks: ticks });
    },

    clearMustActBuild() {
      setState({ tickPhase: "idle", pendingBuildKind: null, pendingBuildTicks: 0 });
    },

    setLastTickToolNames(names: string[] | null) {
      setState({ lastTickToolNames: names });
    },

    pushLastTickToolName(name: string) {
      setState((s) => ({
        lastTickToolNames:
          s.lastTickToolNames === null ? [name] : [...s.lastTickToolNames, name],
      }));
    },

    setLastToolRun(name: string | null) {
      setState({ lastToolRun: name });
    },

    // --- Wake flags (DM, error, soul tick) ---
    setLlmWakePending(value: boolean) {
      setState({ llmWakePending: value });
    },

    setDmReplyPending(value: boolean) {
      setState({ dmReplyPending: value });
    },

    setErrorReplyPending(value: boolean) {
      setState({ errorReplyPending: value });
    },

    setAutonomousSoulTickDue(value: boolean) {
      setState({ autonomousSoulTickDue: value });
    },

    // --- Chat/DM display (last message, sent flag) ---
    setLastAgentChatMessage(text: string | null) {
      setState({ lastAgentChatMessage: text });
    },

    setLastTickSentChat(value: boolean) {
      setState({ lastTickSentChat: value });
    },

    setLastTriggerUserId(id: string | null) {
      setState({ lastTriggerUserId: id });
    },

    // --- Catalog / documents cache (cleared on join_block) ---
    setLastCatalogContext(s: string | null) {
      setState({ lastCatalogContext: s });
    },

    setLastDocumentsList(s: string | null) {
      setState({ lastDocumentsList: s });
    },

    setLastOccupantsSummary(s: string | null) {
      setState({ lastOccupantsSummary: s });
    },

    // --- Movement / autonomous ---
    setMovementTarget(target: { x: number; z: number } | null) {
      setState({ movementTarget: target });
    },

    setMovementIntent(intent: {
      moveX: number;
      moveZ: number;
      sprint: boolean;
    } | null) {
      setState({ movementIntent: intent });
    },

    setMovementSprint(value: boolean) {
      setState({ movementSprint: value });
    },

    setLastBuildTarget(target: BuildTarget | null) {
      setState({ lastBuildTarget: target });
    },

    setAutonomousEmoteStandStillUntil(ts: number) {
      setState({ autonomousEmoteStandStillUntil: ts });
    },

    setPendingGoTalkToAgent(p: {
      targetSessionId: string;
      openingMessage: string;
    } | null) {
      setState({ pendingGoTalkToAgent: p });
    },

    setAutonomousSeekCooldownUntil(ts: number) {
      setState({ autonomousSeekCooldownUntil: ts });
    },

    setNextSeekConsiderAt(ts: number) {
      setState({ nextSeekConsiderAt: ts });
    },

    setConversationEndedSeekCooldownUntil(ts: number) {
      setState({ conversationEndedSeekCooldownUntil: ts });
    },

    // --- Documents by block slot (tracked doc + MML cache) ---
    setDocumentsByBlockSlot(blockSlotId: string, doc: BlockDocument | null) {
      setState((s) => {
        const next = { ...s.documentsByBlockSlot };
        if (doc) next[blockSlotId] = doc;
        else delete next[blockSlotId];
        return { documentsByBlockSlot: next };
      });
    },

    mergeDocumentsByBlockSlot(blockSlotId: string, doc: BlockDocument) {
      setState((s) => ({
        documentsByBlockSlot: { ...s.documentsByBlockSlot, [blockSlotId]: doc },
      }));
    },
  };

  return store;
}

export { createClawStore };
