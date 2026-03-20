# Plan: Single refactor — explicit `currentAction` (tree as source of truth)

**Goal:** Add one state field, `currentAction`, and set it from the behaviour tree so “what is the agent doing” is explicit and the tree is the source of truth. This is the single most important change to reduce fragility.

**Scope:** Only this. No tree-state exposure, no lastCompletedAction, no movement sub-state, no runner changes. Do those later if needed.

**Reference:** [PLAN-AGENT-WAKE-DRIVEN.md](PLAN-AGENT-WAKE-DRIVEN.md) (tree §6, loop §7, agent §11).

---

## 1. State: add `TreeAction` and `currentAction`

**File:** `src/lib/state/state.ts`

- **New type** (add near top, after existing types):

  ```ts
  /** Set by tree agent callbacks. Single source of truth for "what is the agent doing." */
  export type TreeAction =
    | "idle"
    | "movement_only"
    | "obedient"
    | "autonomous_llm"
    | "autonomous_move"
    | "clearing_wake_insufficient_credits"
    | "requesting_autonomous_wake";
  ```

- **Extend `ClawState`:** Add `currentAction: TreeAction` with a short JSDoc that it is set by the tree and is the single place to read current flow.

- **Update `createInitialState`:** Add `currentAction: "idle"`.

**File:** `src/lib/state/store.ts`

- **New method:** `setCurrentAction(action: TreeAction): void` — `setState({ currentAction: action })`.

---

## 2. Tree agent: set `currentAction` at start of each action

**File:** `src/lib/tree/agent.ts`

- At the **start** of each action callback, call `store.setCurrentAction(<value>)` using this mapping:

  | Tree node                     | TreeAction value                        |
  |------------------------------|-----------------------------------------|
  | ExecuteMovementAndDrain      | `"movement_only"`                       |
  | RunObedientAgent             | `"obedient"`                            |
  | RunAutonomousAgent           | `"autonomous_llm"`                      |
  | TryMoveToNearestOccupant     | `"autonomous_move"`                     |
  | ClearWakeInsufficientCredits  | `"clearing_wake_insufficient_credits"`  |
  | RequestAutonomousWake        | `"requesting_autonomous_wake"`         |
  | ClearWakeIdle                | `"idle"`                                |

- **Order:** Call `store.setCurrentAction(...)` as the first line inside each of those seven functions (before any existing logic). For async actions, no extra call on completion—the next tree step will set the next action.

---

## 3. Tests

**File:** `src/lib/tree/agent.test.ts`

- Add (or extend) tests so that when you invoke an action (with a real or mocked store), `store.getState().currentAction` equals the expected `TreeAction` for that node. Cover at least: `ClearWakeIdle` → `"idle"`, `ExecuteMovementAndDrain` → `"movement_only"`, and one of the wake actions (e.g. `ClearWakeInsufficientCredits` → `"clearing_wake_insufficient_credits"`). This guards the mapping.

---

## 4. Documentation

- **This doc:** The table in section 2 is the contract. Keep it in sync if you add or rename tree actions.
- **README:** In the Architecture or State section, add one sentence: “`currentAction` (type `TreeAction`) is set by the behaviour tree and is the single place to read what the agent is currently doing.”

---

## Checklist

| Step | Task |
|------|------|
| 1 | Add `TreeAction`, `currentAction` in state and `createInitialState`; add `setCurrentAction` on store. |
| 2 | In tree agent, at start of each of the 7 action callbacks, call `store.setCurrentAction(<mapped value>)`. |
| 3 | Add agent tests that assert `currentAction` after calling actions. |
| 4 | Document mapping and README note. |

---

## Implementation order

1. State and store (section 1).
2. Tree agent (section 2).
3. Tests (section 3).
4. Docs (section 4).

No runner changes, no loop changes. The tree already runs one branch per tick; we only record it.
