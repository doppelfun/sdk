# Plan: Explicit current action (tree + state refactor)

**Goal:** Make the agent’s current action explicit in state so UI, logs, and tooling can read a single source of truth for “what is the agent doing right now,” and reduce fragility from implicit derivation across the tree and store.

**Context:** See the prior analysis: today “current action” is inferred from `wakePending`, `conversationPhase`, `movementTarget`, etc.; the tree is a black box (no exposure of which node is running); and async LLM runs clear wake at start so state cannot distinguish “running obedient LLM” from “idle.” This plan implements the recommended refactor.

**Reference:** [PLAN-AGENT-WAKE-DRIVEN.md](PLAN-AGENT-WAKE-DRIVEN.md) (tree definition §6, loop §7, agent §11).

---

## 1. Define `TreeAction` and add to state

**File:** `src/lib/state/state.ts`

- **New type:** Add a union type for the explicit high-level action the agent is performing. Values should align 1:1 with tree behaviour and movement reality:

  ```ts
  /** Explicit high-level action; set by tree agent callbacks (and optionally movement). Single source of truth for "what is the agent doing." */
  export type TreeAction =
    | "idle"                    // No wake, or tree hit ClearWakeIdle
    | "movement_only"           // ExecuteMovementAndDrain only (no LLM branch taken)
    | "obedient"                // Running or about to run obedient LLM (owner/cron wake)
    | "autonomous_llm"          // Running or about to run autonomous LLM
    | "autonomous_move"         // Autonomous wake, moving to nearest occupant (no LLM)
    | "clearing_wake_insufficient_credits"
    | "requesting_autonomous_wake";
  ```

- **Extend `ClawState`:**
  - `currentAction: TreeAction` — required, default `"idle"`. Always reflects the current tree-driven (or post-tree) phase.
  - Optional for debugging: `lastCompletedAction: TreeAction | null` and `lastCompletedActionAt: number` (0 when null). Set when an action callback completes (sync or async).

- **Update `createInitialState`:** Set `currentAction: "idle"` and, if added, `lastCompletedAction: null`, `lastCompletedActionAt: 0`.

**File:** `src/lib/state/store.ts`

- **New store methods:**
  - `setCurrentAction(action: TreeAction): void` — `setState({ currentAction: action })`.
  - Optional: `setLastCompletedAction(action: TreeAction): void` — `setState({ lastCompletedAction: action, lastCompletedActionAt: Date.now() })`.

---

## 2. Set `currentAction` in tree agent callbacks

**File:** `src/lib/tree/agent.ts`

- **Dependency:** The agent already receives `store` in `TreeAgentContext`. Use it to call `store.setCurrentAction(...)` at the **start** of each action callback, so that as soon as the tree enters that action, state is updated.

- **Mapping (tree node → TreeAction):**
  - `ExecuteMovementAndDrain` → `"movement_only"` (then at end of same tick the selector will run; we may overwrite with a wake branch. So either set `movement_only` only when no wake branch runs, or set it at start and let the next node overwrite. Prefer: set `movement_only` at start of `ExecuteMovementAndDrain`; when a selector child runs later in the same step it will overwrite.)
  - `RunObedientAgent` → `"obedient"` (at start, before clearWake).
  - `RunAutonomousAgent` → `"autonomous_llm"` (at start, before clearWake).
  - `TryMoveToNearestOccupant` → `"autonomous_move"`.
  - `ClearWakeInsufficientCredits` → `"clearing_wake_insufficient_credits"`.
  - `RequestAutonomousWake` → `"requesting_autonomous_wake"`.
  - `ClearWakeIdle` → `"idle"`.

- **Implementation:** At the top of each of these action functions, add `store.setCurrentAction("<mapped value>")`. For async actions (`RunObedientAgent`, `RunAutonomousAgent`), keep that as-is; when the promise resolves the next tree step will set a new action (e.g. `movement_only` or `idle`), so no need to set “idle” in the callback on completion unless we want an explicit “last completed” (see optional below).

- **Optional – last completed:** When each action returns (and when async actions resolve), call `store.setLastCompletedAction("<same mapped value>")` so debugging/audit has a clear trail.

---

## 3. Reset to `idle` when no wake branch runs

The root selector runs: first movement, then one of the wake branches or `ClearWakeIdle`. Every tick runs `ExecuteMovementAndDrain` first, so we set `movement_only` there; then the selector runs and one child sets the real action. If the selector ends up at `ClearWakeIdle`, we set `idle`. So after a full tree step, `currentAction` will be either one of the wake-related actions or `idle`. No extra “reset” is required **unless** we want to represent “we’re between steps” (e.g. tree returned RUNNING for an async node). In that case the tree is still “in” that node, so keeping `currentAction === "obedient"` or `"autonomous_llm"` until the next step is correct. No change needed beyond step 2.

---

## 4. Expose tree state from the loop (optional but recommended)

**File:** `src/lib/tree/loop.ts`

- **Goal:** Allow consumers (e.g. runner or tests) to inspect tree state so we can later drive `currentAction` from the tree if we want a single source of truth from Mistreevous.

- **Verify Mistreevous API:** BehaviourTree has `getState()` (tree-level) and `getTreeNodeDetails()` (per-node). Check the mistreevous types/README to confirm method names and return shapes.

- **Expose the tree or a snapshot:** Either:
  - **Option A:** Add to `AgentLoop`: `getTreeState(): { state: string; nodeDetails?: unknown }` that returns `behaviourTree.getState()` and optionally `behaviourTree.getTreeNodeDetails()`. Implement by holding a reference to `behaviourTree` in the closure.
  - **Option B:** Keep the loop as-is and only use agent callbacks to set `currentAction` (no tree exposure). Simpler; we can add Option A in a follow-up.

- **Recommendation:** Implement Option A so that (1) tests can assert on tree state, and (2) a future change can sync `currentAction` from the running node (e.g. when a node is RUNNING, map it to TreeAction) if we want the tree to be the single source of truth for “current” as well.

---

## 5. Runner and async completion

**File:** `src/runner.ts`

- No change **required**: `currentAction` is set when the tree enters `RunObedientAgent` / `RunAutonomousAgent`. While the LLM is in flight, the tree node remains RUNNING and we keep `currentAction === "obedient"` or `"autonomous_llm"`. When the promise resolves, the next `step()` will run and the tree will move on (e.g. to `ClearWakeIdle` or back to movement), and the agent callback for that node will set the new `currentAction`.

- **Optional:** After `runAgentTickWithFallback` resolves, call `store.setLastCompletedAction("obedient")` or `"autonomous_llm"` so “last completed” is accurate even if the next step is delayed.

---

## 6. Movement sub-state (optional, follow-up)

**File:** `src/lib/state/state.ts` (and store)

- **Optional:** Add a small union for movement mode, e.g. `movementMode: "idle" | "moving_to_target" | "following" | "wandering"` and set it in `movementDriverTick` so “current action” can be refined to “obedient + moving_to_target” if needed. Defer to a follow-up unless you need it for UI in this refactor.

---

## 7. Tests

- **Unit tests – tree agent (`src/lib/tree/agent.test.ts`):**
  - For each action that sets `currentAction`, assert that after calling the action (or the condition path that leads to it), `store.getState().currentAction` is the expected value. Mock or use a real store; focus on the mapping from tree node to TreeAction.

- **Loop tests (if loop exposes tree state):**
  - If `getTreeState()` was added, add a test that steps the tree and asserts on `getTreeState()` (e.g. after a step that runs an async action, state is RUNNING; after sync action, state may be SUCCEEDED).

- **Integration / runner:**
  - Optionally assert that after triggering a wake and stepping until completion, `currentAction` goes from `obedient` or `autonomous_llm` to `idle` or `movement_only`. Can be done in an existing runner test or a small new one.

---

## 8. Documentation

- **In this plan (or PLAN-AGENT-WAKE-DRIVEN):** Add a short “Tree → currentAction mapping” section that lists each tree action node and its `TreeAction` value. This keeps the contract explicit and prevents drift.

- **README:** In the Architecture / State section, mention that `currentAction` is the single field to read for “what is the agent doing,” and that it is set by the behaviour tree agent callbacks (and optionally movement driver in a follow-up).

---

## 9. Checklist summary

| Step | Task |
|------|------|
| 1 | Add `TreeAction` type and `currentAction` (and optional `lastCompletedAction` / `lastCompletedActionAt`) to `ClawState` and `createInitialState`; add `setCurrentAction` (and optional `setLastCompletedAction`) to store. |
| 2 | In tree agent, at start of each action callback, call `store.setCurrentAction(<mapped value>)`; optionally call `setLastCompletedAction` on completion. |
| 3 | No extra reset logic; tree order and callbacks suffice. |
| 4 | (Optional) Expose `getTreeState()` from loop; verify Mistreevous API. |
| 5 | No required runner change; optional `setLastCompletedAction` after LLM tick. |
| 6 | (Optional) Defer movement sub-state to follow-up. |
| 7 | Add/update tests for agent (currentAction assertions) and loop (getTreeState if added). |
| 8 | Document tree → currentAction mapping and README note on `currentAction`. |

---

## 10. Order of implementation

1. **State and store** (section 1) — types and store API.
2. **Tree agent** (section 2) — set `currentAction` (and optional `lastCompletedAction`) in every action.
3. **Loop** (section 4) — optional `getTreeState()`.
4. **Tests** (section 7).
5. **Docs** (section 8).
6. **Runner** (section 5) — optional last-completed after LLM.

This order avoids breaking callers: new state fields are additive; then tree and loop expose the new behaviour; then tests and docs capture the contract.

---

## Appendix: Tree node → TreeAction mapping

| Tree node (action) | TreeAction |
|--------------------|------------|
| ExecuteMovementAndDrain | `movement_only` |
| RunObedientAgent | `obedient` |
| RunAutonomousAgent | `autonomous_llm` |
| TryMoveToNearestOccupant | `autonomous_move` |
| ClearWakeInsufficientCredits | `clearing_wake_insufficient_credits` |
| RequestAutonomousWake | `requesting_autonomous_wake` |
| ClearWakeIdle | `idle` |

Conditions do not set `currentAction`; only these action nodes do.
