/**
 * Claw store — Zustand-backed state for one agent.
 * One store per agent; tree, runner, movement, and tools read/write via getState/setState and named actions.
 */

import { createStore } from "zustand/vanilla";
import type { Occupant } from "@doppelfun/sdk";
import {
  createInitialState,
  type ClawState,
  type ChatEntry,
  type PendingScheduledTask,
  type BuildTarget,
  type BlockDocument,
  type TreeAction,
  type AutonomousGoal,
} from "./state.js";

export type ClawStore = ReturnType<typeof createClawStore>;

export type ClawStoreApi = {
  getState: () => ClawState;
  setState: (partial: Partial<ClawState> | ((s: ClawState) => Partial<ClawState>)) => void;
};

/**
 * Create the Zustand-backed Claw store for one agent. Holds wake state, chat, movement, documents, build context.
 *
 * @param blockSlotId - Initial block slot id (e.g. from join block)
 * @returns Store with getState, setState, and named actions (setWakePending, pushChat, etc.)
 */
function createClawStore(blockSlotId: string) {
  const vanillaStore = createStore<ClawState>(() => createInitialState(blockSlotId));
  const getState = vanillaStore.getState;
  const setState = vanillaStore.setState;

  const store = {
    getState,
    setState,

    // --- Wake (requestWake, tree consumes) ---
    setWakePending(value: boolean) {
      setState({ wakePending: value });
    },
    clearWake() {
      setState({ wakePending: false });
    },
    setLastTriggerUserId(id: string | null) {
      setState({ lastTriggerUserId: id });
    },
    setPendingScheduledTask(task: PendingScheduledTask | null) {
      setState({ pendingScheduledTask: task });
    },
    clearPendingScheduledTask() {
      setState({ pendingScheduledTask: null });
    },
    setLastAutonomousRunAt(ts: number) {
      setState({ lastAutonomousRunAt: ts });
    },
    setLastOwnerConversationAt(ts: number) {
      setState({ lastOwnerConversationAt: ts });
    },
    setAutonomousGoal(goal: AutonomousGoal) {
      setState({ autonomousGoal: goal });
    },
    setAutonomousTargetSessionId(sessionId: string | null) {
      setState({ autonomousTargetSessionId: sessionId });
    },
    setSocialSeekCooldownUntil(ts: number) {
      setState({ socialSeekCooldownUntil: ts });
    },
    setLastSocialSeekTargetSessionId(sessionId: string | null) {
      setState({ lastSocialSeekTargetSessionId: sessionId });
    },
    setCurrentAction(action: TreeAction) {
      setState({ currentAction: action });
    },
    setLastCompletedAction(action: TreeAction) {
      setState({ lastCompletedAction: action, lastCompletedActionAt: Date.now() });
    },
    setThinking(value: boolean) {
      setState({ isThinking: value });
    },

    // --- Chat / owner ---
    pushChat(entry: ChatEntry, max: number) {
      setState((s) => {
        if (entry.id != null && s.chat.some((c) => c.id === entry.id)) return s;
        return { chat: [...s.chat, entry].slice(-max) };
      });
    },
    pushOwnerMessage(text: string, max: number) {
      setState((s) => ({
        ownerMessages: [...s.ownerMessages, { text, at: Date.now() }].slice(-max),
      }));
    },
    /** Clear owner messages after responding so only the next new message is "current". */
    clearOwnerMessages() {
      setState({ ownerMessages: [] });
    },

    // --- Core ---
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

    // --- Movement ---
    setMovementTarget(target: { x: number; z: number } | null) {
      setState({
        movementTarget: target,
        movementTargetSetAt: target != null ? Date.now() : 0,
      });
    },
    setLastMoveToFailed(p: { x: number; z: number } | null) {
      setState({ lastMoveToFailed: p });
    },
    setFollowTargetSessionId(sessionId: string | null) {
      setState((s) => ({
        followTargetSessionId: sessionId,
        followStartedAt: sessionId != null && sessionId !== "" ? Date.now() : 0,
        ...(sessionId != null && sessionId !== "" ? { lastFollowFailed: null } : {}),
      }));
    },
    setLastFollowFailed(targetSessionId: string | null) {
      setState({
        lastFollowFailed: targetSessionId,
        followTargetSessionId: null,
        followStartedAt: 0,
      });
    },
    setMovementIntent(intent: { moveX: number; moveZ: number; sprint: boolean } | null) {
      setState({ movementIntent: intent });
    },
    setWanderState(wander: ClawState["wanderState"]) {
      setState({ wanderState: wander });
    },
    setNextWanderDestinationAt(ts: number) {
      setState({ nextWanderDestinationAt: ts });
    },
    setNextAutonomousMoveAt(ts: number) {
      setState({ nextAutonomousMoveAt: ts });
    },
    setLastBuildTarget(target: BuildTarget | null) {
      setState({ lastBuildTarget: target });
    },
    setMovementSprint(value: boolean) {
      setState({ movementSprint: value });
    },
    setMovementStopDistanceM(m: number) {
      setState({ movementStopDistanceM: m });
    },
    setAutonomousEmoteStandStillUntil(ts: number) {
      setState({ autonomousEmoteStandStillUntil: ts });
    },
    setPendingGoTalkToAgent(p: { targetSessionId: string; openingMessage: string } | null) {
      setState({
        pendingGoTalkToAgent: p,
        pendingGoTalkSince: p != null ? Date.now() : 0,
      });
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
    setLastOccupantsSummary(s: string | null) {
      setState({ lastOccupantsSummary: s });
    },
    /** Update cached balance (e.g. after hub checkBalance or reportUsage). */
    setCachedBalance(balance: number) {
      setState({ cachedBalance: balance });
    },
    /** Update daily spend (e.g. from hub or after reportUsage). */
    setDailySpend(spend: number) {
      setState({ dailySpend: spend });
    },

    // --- Documents (build tools) ---
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
    setLastDocumentsList(summary: string | null) {
      setState({ lastDocumentsList: summary });
    },
    setLastCatalogContext(compact: string | null) {
      setState({ lastCatalogContext: compact });
    },

    // --- Conversation ---
    setConversationPhase(phase: ClawState["conversationPhase"]) {
      setState({ conversationPhase: phase });
    },
    setConversationPeerSessionId(id: string | null) {
      setState({ conversationPeerSessionId: id });
    },
    setReceiveDelayUntil(ts: number) {
      setState({ receiveDelayUntil: ts });
    },
    setWaitingForReplySince(ts: number) {
      setState({ waitingForReplySince: ts });
    },
    setPendingDmReply(p: ClawState["pendingDmReply"]) {
      setState({ pendingDmReply: p });
    },
    setLastDmPeerSessionId(id: string | null) {
      setState({ lastDmPeerSessionId: id });
    },
    setConversationRoundCount(n: number) {
      setState({ conversationRoundCount: n });
    },
    setLastAgentChatMessage(text: string | null) {
      setState({ lastAgentChatMessage: text != null && text.trim() ? text.trim() : null });
    },
    setLastTickSentChat(value: boolean) {
      setState({ lastTickSentChat: value });
    },

    // --- Errors ---
    setLastError(code: string, message: string, blockSlotId?: string) {
      setState({ lastError: { code, message, blockSlotId } });
    },
    clearLastError() {
      setState({ lastError: null });
    },

    /**
     * After engine downtime + cold WS reconnect: reset session/movement/social state so stale sessionIds
     * and targets are not used. Preserves chat, documents, catalog cache, and hub credit/activity fields.
     */
    applyEngineColdReset() {
      setState((s) => {
        const fresh = createInitialState(s.blockSlotId);
        return {
          ...fresh,
          chat: s.chat,
          documentsByBlockSlot: s.documentsByBlockSlot,
          lastDocumentsList: s.lastDocumentsList,
          lastCatalogContext: s.lastCatalogContext,
          cachedBalance: s.cachedBalance,
          hubCoarseActivity: s.hubCoarseActivity,
          hubActivityEndAtMs: s.hubActivityEndAtMs,
          dailySpend: s.dailySpend,
          nextActivityGlobalBlurbAt: s.nextActivityGlobalBlurbAt,
          nextTrainingSpellcastEmoteAt: s.nextTrainingSpellcastEmoteAt,
        };
      });
    },

    // --- Tool tracking ---
    setLastToolRun(name: string | null) {
      setState({ lastToolRun: name });
    },
    setLastTickToolNames(names: string[] | null) {
      setState({ lastTickToolNames: names });
    },
  };

  return store;
}

export { createClawStore };
