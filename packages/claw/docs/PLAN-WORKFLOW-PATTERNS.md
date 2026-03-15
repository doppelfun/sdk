# Plan: Refactor Claw State Loop to AI SDK Workflow Patterns

## Overview

Refactor the claw agent’s tick loop and state flow to align with [AI SDK workflow patterns](https://ai-sdk.dev/docs/agents/workflows): **Routing**, **Sequential (chains)**, **Evaluator–optimizer**, and optional **Orchestrator–worker**. The goal is clearer structure, easier extension, and better fit with the AI SDK’s recommended agent design.

## Reference

- **AI SDK Workflow Patterns:** https://ai-sdk.dev/docs/agents/workflows  
- **Existing tick loop plan:** `src/lib/agent/TICK_LOOP_PLAN.md` (scheduling, intent, wake, fast-tick)
- **AI SDK ToolLoopAgent refactor:** `docs/PLAN-AI-SDK-REFACTOR.md` (migrating from raw `generateText` to `ToolLoopAgent`)

---

## Current State (Summary)

| Component | Behavior |
|-----------|----------|
| **runTick** | Boundary join (one-off) → `computeTickIntent(state, config)` → switch: `idle_skip` \| `build_procedural` \| `build_llm` \| `llm_tick`. |
| **Intent** | Derived from `tickPhase`, `llmWakePending`, `lastError`, `autonomousSoulTickDue`, owner proximity, build timeouts. |
| **handleLlmTick** | Single `generateText` with tools → then ad-hoc fallbacks (DM ack, error reply) if no tool calls. |
| **Wake** | DM / owner / error set flags; `requestWakeTick` debounces and optionally runs build-intent classification before scheduling a tick. |
| **Scheduling** | `getNextTickDelay(state, config, opts)` → `delayMs \| null`; scheduler runs tick after delay or on follow-up. |
| **50 ms loop** | checkBreak, autonomousManager, movementDriver, drainPendingReply (separate from “workflow”). |
| **Movement (move_to)** | Move tool sets `movementTarget` and calls `client.moveTo(x, z)`. Server pathfinds and drives movement each tick; no waypoints sent to client. Every 50 ms `movementDriverTick` only checks arrival (distance &lt; stop) and runs arrival logic (clear target, pendingGoTalkToAgent, etc.); it does not send stick input toward target. |
| **Conversation flow** | FSM in state: `idle` \| `can_reply` \| `waiting_for_reply`. `canSendDmTo(store, sessionId)` gates chat tool and reply actions; when blocked we set `pendingDmReply`; 50 ms loop calls `drainPendingReply` and, if pending and now allowed, sends via `sendDmAndTransition`. `onWeSentDm` / `onWeReceivedDm` drive transitions; `checkBreak` (timeout, rounds, owner message, etc.) resets to idle. |

Current flow is effectively **routing** (intent → handler) plus **one-shot LLM + tools** with imperative fallbacks. Movement and conversation are **state-driven loops** (50 ms) that consume state set by tools and wake handlers; there is no explicit “evaluate then retry/improve” or “orchestrator then worker” structure for these flows.

---

## Target Patterns (from AI SDK)

1. **Routing** – Decide which path to take from context (we already do this via `computeTickIntent`).
2. **Sequential (chains)** – Steps in order; one step’s output is next step’s input.
3. **Evaluator–optimizer** – Evaluate result; if not good enough, retry or take corrective action (e.g. fallback reply).
4. **Orchestrator–worker** – One model coordinates; workers do subtasks (e.g. build phase: classify → procedural or build_llm worker).

---

## Proposed Refactors

### 1. Formalize routing (Routing pattern)

**Current:** `computeTickIntent` + switch in `runTick` is already routing. Make it a first-class “workflow router” and name it accordingly.

**Steps:**

- Rename or wrap the current flow as a **workflow router** that returns a **workflow step** (e.g. `IdleSkip` \| `BuildProcedural` \| `BuildLlm` \| `LlmChat`).
- Keep `computeTickIntent` as the pure function that selects the step from `(state, config)`.
- Optionally add a small **workflow types** module: `WorkflowStep`, `StepResult`, so future steps (e.g. “evaluate then fallback”) can be added without ad-hoc branches.

**Files:** `tickRunner.ts`, optionally `workflow/types.ts` or `workflow/router.ts`.

**Outcome:** Explicit “router → step” mapping; adding a new path = new intent + new step handler.

---

### 2. Build phase as orchestrator–worker (Orchestrator–worker pattern)

**Current:** On wake with message, we sometimes call `classifyBuildIntent(msg)` then set `tickPhase` / `pendingBuildKind` and run a tick. The tick then does either `handleBuildProcedural` or `handleBuildLlm`. The “orchestrator” (classify) and “worker” (procedural vs build_llm) are split across `createRequestWakeTick` and `runTick`.

**Steps:**

- Treat **build phase** as a single workflow: **orchestrator** = “classify build intent from current state/message”; **workers** = “run procedural” vs “run build-only LLM”.
- Move build-intent classification into the tick (or a dedicated “build workflow” entry point) so one workflow owns: classify → then run the chosen worker. Today classification runs inside the wake debounce; it can instead run as the first step of the build workflow inside `runTick`, so all build logic lives under one intent.
- **Option A (minimal):** Keep classification in wake; in `runTick`, when intent is `build_procedural` or `build_llm`, call a small `runBuildWorkflow(ctx)` that runs the appropriate worker. No structural change to when we classify.
- **Option B (full orchestrator):** On `must_act_build`, first step is “classify” (if not already done): call `classifyBuildIntent` with last user message; set `pendingBuildKind` from result; then run procedural or build_llm worker. That makes “build” a two-step chain: classify → execute.

**Files:** `tickRunner.ts`, `DoppelAgent.ts` (createRequestWakeTick), optionally `workflow/buildWorkflow.ts`.

**Outcome:** Build phase is clearly “orchestrator (classify) → worker (procedural or build_llm)”;
easier to add more workers (e.g. “build_with_code only”) later.

---

### 3. LLM tick as a short chain (Sequential pattern)

**Current:** `handleLlmTick`: build user message → `generateText` with tools → then ad-hoc checks for “no tool calls” and “we owe DM/error reply” and send fallbacks.

**Steps:**

- Model the **LLM chat tick** as a small **sequential chain**:
  1. **Step 1 – Act:** Build user message; run `generateText` with tools (and tool fallback execution if needed).
  2. **Step 2 – Respond:** From step 1 result + state, decide if we need to send a reply (DM fallback, DM ack after tools, error fallback). If yes, send one reply and update state (e.g. clear pending flags).

- Extract “should we send a fallback and what text?” into a pure function:  
  `evaluateReplyNeeded(state, llmResult): { send: boolean; text: string; targetSessionId?: string }`.  
  Then the “respond” step calls that and, if `send`, calls `sendFallbackReply` (or equivalent) once. No branching on `dmReplyPending` / `errorReplyPending` / `hadToolCalls` scattered in the handler.

**Files:** `tickRunner.ts` (handleLlmTick), optionally `workflow/llmChatWorkflow.ts` or `workflow/respondStep.ts`.

**Outcome:** “Act → evaluate reply need → respond” is a clear two-step chain; adding new reply rules is done in one place (evaluate).

---

### 4. Reply logic as evaluator–optimizer (Evaluator–optimizer pattern)

**Current:** After `generateText`, we check `dmReplyPending`, `hadToolCalls`, `lastTickSentChat`, `errorReplyPending` and sometimes send a fallback. This is “evaluate then correct” but implicit.

**Steps:**

- Introduce an **evaluation** step that only decides “do we owe a reply and what?”:
  - Input: `state` (pending flags, last peer, etc.) + `llmResult` (hadToolCalls, replyText).
  - Output: `{ action: 'none' } | { action: 'send'; text: string; targetSessionId?: string; logLabel?: string }`.
- **Optimizer** = “apply the action”: if action is `send`, call `sendFallbackReply` (or equivalent) and clear the relevant pending flags. No retry loop unless we later add “if send failed, retry with different text”; for now a single “evaluate → apply” pass is enough.

**Steps (concrete):**

- Add `evaluateReplyAction(state, llmResult): ReplyAction` in a small module (e.g. `workflow/evaluateReply.ts`).
- In the LLM chat workflow (or handleLlmTick), after `generateText`:  
  `const action = evaluateReplyAction(store.getState(), result)` then if `action.action === 'send'`, call existing `sendFallbackReply` and clear flags. Replace the current if/else blocks for DM fallback, DM ack after tools, and error fallback with this single path.

**Files:** New `workflow/evaluateReply.ts` (or under `tickRunner`), `tickRunner.ts` (handleLlmTick).

**Outcome:** Reply behavior is “evaluate once → apply”; new reply rules (e.g. “ack when moved”) are added in `evaluateReplyAction`.

---

### 5. Movement (move_to, server-driven)

**Current:** Move tool (with `approachPosition` or `approachSessionId`) sets `movementTarget` and calls `client.moveTo(x, z)`. Server runs pathfinding and sends a `waypoints` message; the agent’s WS handler calls `store.setMovementWaypoints(list)`. The **50 ms fast-tick** runs `movementDriverTick`: it reads `movementTarget` and `movementWaypoints` from state, steers toward the current waypoint (or target if no waypoints), advances waypoint index when within radius or when passed, and clears target/waypoints when within stop distance. So: **one LLM tool call** kicks off an **asynchronous, state-driven movement flow** that runs until arrival.

**How it fits workflow patterns:**

- **Sequential at the “move” level:** User says “go to 37,30” → LLM calls `move(approachPosition: "37,30")` → **Step 1:** set target + `sendRequestPath(37, 30)`; **Step 2:** (async) server returns waypoints → store updated; **Step 3:** (continuous) driver consumes waypoints/target every 50 ms until done. Steps 1–2 are request/response; step 3 is a **state-driven loop** (not a single LLM step). The plan doesn’t require changing this—it’s already a clear chain: tool → request path → receive waypoints → driver follows.
- **Optional refactor:** Make the “move workflow” explicit in code: e.g. `runMoveWorkflow(ctx, target)` that (1) sets target and sends path request, (2) returns without waiting for waypoints; the 50 ms loop remains the consumer. That keeps “request path then follow” as a documented two-phase flow without blocking the tick.

**Steps (optional):**

- Document in the codebase (or in this plan) that **movement** = move tool (sets target + request_path) → waypoints message (sets waypoints) → movement driver (follows until arrival). No change to runtime behavior.
- If desired, add a small **movement workflow** type or helper that encapsulates “set target + send path request” and, in the move tool, call it so the two-phase flow is named (e.g. `initiatePathTo(ctx, x, z)`).

**Files:** `tools/handlers/move.ts`, `movement/movementDriver.ts`, `agent/DoppelAgent.ts` (waypoints message handler). No change required for pattern alignment; optional naming/encapsulation only.

**Outcome:** Movement and waypoints are clearly “initiate (tool) → receive (WS) → execute (50 ms loop)”; easier to reason about and to add e.g. “cancel move” or “re-request path if stuck” later.

---

### 6. Conversation flow (Routing + sequential drain)

**Current:** Conversation is an explicit **FSM** (`idle` | `can_reply` | `waiting_for_reply`) in state. `canSendDmTo(store, sessionId)` gates whether we may send a DM. When the **chat tool** runs and we’re not allowed to send yet (e.g. in receive delay), we set `pendingDmReply` and return “queued.” The **50 ms loop** calls `drainPendingReply(store)`; if it returns a pending reply and `canSendDmTo` is now true, we send via `sendDmAndTransition`. So: **routing** (can we send? → send vs queue) and a **drain step** (when delay passes, send the queued reply).

**How it fits workflow patterns:**

- **Routing:** Before sending any DM (from chat tool or from reply fallback), we effectively **route** on conversation state: `canSendDmTo` → send now; else → set `pendingDmReply` and exit. That’s already a single gate; the plan can make it explicit as “evaluate send: send_now | queue.”
- **Sequential drain:** The 50 ms loop runs: checkBreak → autonomous → movement → **drain pending reply**. So “drain” is the last step of a small **chain** each 50 ms: conversation break check → movement → reply drain. No change needed; just document that the fast-tick is a fixed **sequence** of steps.

**Steps (optional):**

- Introduce **evaluateSendReply(store, targetSessionId, text, now):** returns `{ action: 'send_now' } | { action: 'queue'; pendingDmReply: ... }`. The chat tool and any “send fallback” path call this instead of inlining `canSendDmTo` + set pending. Single place for “can we send or do we queue?”
- Keep **drainPendingReply** as the **apply** step for queued replies; it already runs in the 50 ms loop after movement. Optionally have it call the same “evaluate send” so logic stays in one place (e.g. “if pending and canSendDmTo(now), send and clear pending”).

**Files:** `conversation/conversation.ts`, `conversation/index.ts`, `tools/handlers/chat.ts`, `agent/fastTick.ts`, `agent/tickRunner.ts` (sendFallbackReply). See also `conversation/PLAN.md` for FSM and break conditions.

**Outcome:** Conversation flow is explicit as “evaluate send → send or queue” and “drain step applies queued reply when allowed”; FSM remains the source of truth for when we’re allowed to send.

---

### 7. Wake and scheduling (unchanged by workflow patterns)

Keep the existing design:

- **Wake:** `requestWakeTick(reason, message?)` sets flags and debounces; optional build-intent classification; then schedule tick (or request follow-up). This stays the single entry point for “something happened, consider running a tick.”
- **Scheduling:** `getNextTickDelay(state, config, opts)` remains the pure policy; scheduler and `.finally()` behavior stay as in `TICK_LOOP_PLAN.md`.

Workflow patterns don’t require changing when we run the next tick; they structure what happens **inside** a tick (routing, chains, evaluate–apply).

---

## Implementation Order

| Phase | Focus | Deliverable | Status |
|-------|--------|-------------|--------|
| **1** | Formalize routing | Router type + explicit step type; optional `workflow/types.ts`. Keep current handlers; rename only if helpful. | **Done:** `workflow/types.ts`; `computeTickIntent` documented as router. |
| **2** | Evaluator for reply | `evaluateReplyAction(state, llmResult)`; handleLlmTick uses it and a single “apply reply” path. |
| **3** | LLM tick as chain | “Act” step (build message + generateText + tool fallback) → “Respond” step (evaluateReplyAction + send if needed). |
| **4** | Build as orchestrator–worker | Either move classify into first step of build workflow (Option B) or add `runBuildWorkflow` that runs the chosen worker (Option A). | Optional. |
| **5** | Movement / waypoints (doc or optional) | Document “initiate path → receive waypoints → driver follows”; optionally add `initiatePathTo` or `runMoveWorkflow` so the two-phase flow is named. |
| **6** | Conversation (optional) | Add `evaluateSendReply(store, targetSessionId, text)` → send_now \| queue; chat tool and fallbacks use it; drain step stays in 50 ms loop. | Optional. |

Phases 1–3 give the most benefit (clear routing, single place for reply rules, clear act→respond chain). Phase 4 is optional for a clearer build story. Phases 5–6 are optional and align movement/conversation with the same workflow vocabulary (sequential + routing) without changing behavior.

**Status:** All six phases are implemented (evaluateReplyAction, Act→Respond, runBuildWorkflow, MOVEMENT.md, evaluateSendReply).

---

## File and Module Sketch

- **`workflow/types.ts`** (optional) – `WorkflowStep`, `StepResult`, `ReplyAction`.
- **`workflow/evaluateReply.ts`** – `evaluateReplyAction(state, llmResult): ReplyAction`; encapsulates all “should we send a reply and what text?” rules.
- **`workflow/router.ts`** (optional) – Wrapper around `computeTickIntent` that returns a step type for the runner.
- **`workflow/llmChatWorkflow.ts`** (optional) – `runLlmChatWorkflow(ctx)`: act step (user message + generateText + tool fallback) → evaluate reply → respond step. Replaces inline handleLlmTick body.
- **`workflow/buildWorkflow.ts`** (optional, Phase 4) – `runBuildWorkflow(ctx)`: optionally classify → then run procedural or build_llm worker.
- **`tickRunner.ts`** – Calls router; switch invokes either small handlers or workflow runners (e.g. `runLlmChatWorkflow`, `runBuildWorkflow`). Uses `evaluateReplyAction` in the LLM path.
- **Movement (move_to):** `tools/handlers/move.ts` (sets target + `client.moveTo(x,z)`), `movement/movementDriver.ts` (checks arrival only; server drives movement).
- **Conversation (existing):** `conversation/conversation.ts` (FSM, canSendDmTo, onWeSentDm, onWeReceivedDm, drainPendingReply, checkBreak), `conversation/PLAN.md`. Optional: `evaluateSendReply(store, targetSessionId, text)` used by chat tool and fallbacks.

Existing modules (`scheduling.ts`, `state`, `tools`, `llm/toolsAi`, `movement/`, `conversation/`) stay; only the **control flow** inside a tick (and optionally movement/conversation gates) is refactored into workflow-shaped steps.

---

## Success Criteria

- **Routing:** One place that maps (state, config) → next step; adding a new tick behavior = new intent + new step.
- **Reply behavior:** All “should we send a reply after this LLM turn?” logic in one evaluator; one “apply” path.
- **Readability:** “Act → evaluate reply → respond” and (optionally) “classify build → run build worker” are visible in code structure.
- **Movement / waypoints:** Documented or named as “initiate path → receive waypoints → driver follows”; no behavioral change unless we add cancel/re-request later.
- **Conversation flow:** FSM remains the gate for sending; optionally one “evaluate send → send_now | queue” used by chat tool and fallbacks; drain step unchanged in 50 ms loop.
- **Tests:** `computeTickIntent` (and any new router) stays well-tested; add tests for `evaluateReplyAction` with different state + llmResult combinations; conversation and movement tests remain valid.
- **No regression:** Existing behavior (wake, scheduling, 50 ms loop, tools, fallbacks, movement, conversation) preserved; only structure and placement of logic change.

---

## References

- [AI SDK Workflow Patterns](https://ai-sdk.dev/docs/agents/workflows) – Sequential, Routing, Evaluator–optimizer, Orchestrator–worker.
- `src/lib/agent/TICK_LOOP_PLAN.md` – Scheduling, intent, wake, fast-tick handler list.
- `src/lib/conversation/PLAN.md` – Conversation FSM, turn-taking, break conditions, drain.
