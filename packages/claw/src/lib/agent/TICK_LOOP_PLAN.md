# Tick Loop Improvements — Plan

## Overview

The **tick loop** is the main control loop of the claw agent. It runs in discrete steps called **ticks**. Each tick is one cycle (e.g. one boundary join, one build step, one idle skip, or one full LLM turn with tools and fallbacks). This plan makes the tick loop more extensible and maintainable.

## Goal

Make the **tick loop** more **extensible** and **maintainable** by:

1. Extracting scheduling policy into a pure, testable function (when to run the next tick).
2. Driving each tick from a single computed "intent" instead of inline conditionals.
3. Treating "wake" as a first-class concept with one entry point.
4. Making the 50 ms loop extensible via a handler list.
5. Replacing refs and closures with an explicit scheduler API.
6. (Optional) Separating "after tick" state updates from scheduling so the delay policy is independent and testable.

---

## Current State (brief)

- **agent.ts**: The tick loop is implemented as `runTickThenScheduleNext`: it runs one tick via `runTick`, then in `.finally()` computes the next tick delay from state (if/else over `wakeAfterTickRef`, `tickPhase`, `lastError`, `npcStyleIdle`, owner away, etc.) and schedules the next tick via `setTimeout`. Refs: `tickScheduledRef`, `wakeAfterTickRef`, `tickInProgress`.
- **tickRunner.ts**: Each tick (`runTick`) does boundary join → `must_act_build` (procedural vs build-only LLM) → idle-skip check → normal LLM tick → DM/error fallbacks. Many `getState()` calls and branches.
- **50 ms loop**: Single `setInterval` in agent.ts that runs `checkBreak`, `autonomousManager.tick`, `movementDriverTick`, `drainPendingReply` (+ `sendDmAndTransition`) in order.

---

## 1. Extract `getNextTickDelay` (scheduling policy)

**Goal:** One place that decides "when should the next tick run?" so new rules don’t require editing the loop body.

**Steps:**

1. Add a module (e.g. `src/lib/agent/scheduling.ts` or next to agent) with:
   - **Input:** `state: ClawState`, `config: ClawConfig`, `opts: { needImmediateFollowUp: boolean }`.
   - **Output:** `number | null` (delay in ms; `null` = do not schedule, e.g. NPC idle).
   - **Logic:** Move the exact if/else from the current `.finally()` block into this function (needImmediateFollowUp → 0; tickPhase === "must_act_build" → 0; lastError → tickIntervalMs; npcStyleIdle && !llmWakePending → owner-away soul tick delay or null; else → tickIntervalMs). When scheduling a soul tick, the function does **not** mutate store; the caller (agent) remains responsible for `setAutonomousSoulTickDue(true)` when delay is soul-tick.
2. In `agent.ts`, inside the `.finally()` block: call `getNextTickDelay(store.getState(), config, { needImmediateFollowUp: wakeAfterTickRef.current })`. If return is a number, schedule the next tick via `setTimeout(runTickThenScheduleNext, delay)`; if null, do not schedule. Keep the single place that sets `setAutonomousSoulTickDue(true)` (today it’s inside the branch that chooses soul tick delay) — either leave that in agent or pass a callback into the policy; prefer leaving in agent for minimal API surface.
3. Add unit tests for `getNextTickDelay`: given state + config + opts, assert returned delay or null. Cover: follow-up, must_act_build, lastError, npc idle + owner away, npc idle + owner nearby, non-NPC.

**Files:** New `scheduling.ts` (or `getNextTickDelay` in existing file), `agent.ts`, tests (e.g. `scheduling.test.ts`).

---

## 2. Tick intent + switch in `runTick`

**Goal:** One computed "intent" per tick so adding a new phase is "add intent kind + handler" instead of more branches in a long function.

**Steps:**

1. Define **tick intent type** (e.g. in `tickRunner.ts` or `tickRunner.types.ts`):
   - `{ kind: 'boundary_join' }`
   - `{ kind: 'build_procedural'; proceduralKind: 'city' | 'pyramid' }`
   - `{ kind: 'build_llm' }`
   - `{ kind: 'idle_skip' }`
   - `{ kind: 'llm_tick'; soulTick?: boolean }`
2. Implement **`computeTickIntent(state: ClawState, config: ClawConfig): TickIntent`** that encodes current rules:
   - If `lastError?.code === 'region_boundary'` and `lastError.blockSlotId` → `boundary_join`.
   - Else if `tickPhase === 'must_act_build'`: if over max ticks or owner-build-blocked → treat as idle_skip (or a dedicated "clear_build" intent if you want); else if `pendingBuildKind` → `build_procedural`; else → `build_llm`.
   - Else if no wake and no error and no soul tick → `idle_skip`.
   - Else → `llm_tick` (set `soulTick` from `autonomousSoulTickDue` and owner proximity).
   - Boundary handling that only does join and clear error can stay as a pre-step before intent, or be the first intent; the plan assumes boundary is one intent so the rest of the tick sees clean state.
3. Refactor **`runTick`** to:
   - (Optional) Handle boundary once at top (current behavior: join + clear error), then recompute intent if you want intent to never be boundary after first pass; or compute intent first and if boundary_join, do join + clear and return (no tool/LLM).
   - Set `lastTickToolNames([])` once at start.
   - Compute intent from current state.
   - Switch on `intent.kind`: call small handlers (e.g. `handleBoundaryJoin`, `handleBuildProcedural`, `handleBuildLLM`, `handleIdleSkip`, `handleLlmTick`) that receive (client, store, config, systemContent, options, onToolResult). Each handler is responsible for any store updates and return; `handleLlmTick` contains current "normal" LLM path + fallbacks.
4. Add unit tests for **`computeTickIntent`** only: given state + config, assert intent. Cover all branches (boundary, build procedural, build LLM, idle skip, llm_tick with/without soulTick).

**Files:** `tickRunner.ts` (and optionally `tickRunner.types.ts`), `tickRunner.test.ts` (or `computeTickIntent.test.ts`).

---

## 3. First-class wake abstraction

**Goal:** One way to request a tick (DM, owner, error, soul, follow-up) so the scheduler and runTick don’t depend on multiple booleans; new wake sources are a single call.

**Steps:**

1. Define a **wake API** used by the agent:
   - Option A — **minimal:** Keep existing store flags (`llmWakePending`, `dmReplyPending`, etc.) but introduce `requestWake(reason: WakeReason)` in one place (e.g. next to `createRequestWakeTick`). It sets the right flags for the reason (e.g. reason `'dm'` → llmWakePending + dmReplyPending). All current call sites (chat handler, error handler, soul scheduler) call `requestWake(reason)` instead of setting store directly. Scheduler and runTick still read store; only the "cause" is centralized.
   - Option B — **state layer:** Add a small `wakeReasons: Set<WakeReason>` (or a single "pending wake" with reason) in state or in a tiny WakeManager; `requestWake(reason)` adds to set; after tick, clear. runTick and getNextTickDelay derive "should run / need follow-up" from that set. Store flags (dmReplyPending, etc.) can be derived from wake reason or set in requestWake. Prefer Option A for smaller change; Option B if you want to fully replace booleans later.
2. Implement **`requestWake(reason, wakeMessage?)`** (or keep the name `requestWakeTick` and have it call a shared wake setter): set `llmWakePending`; if reason is `'dm'` set `dmReplyPending`; if tick is running set follow-up; else debounce and run tick (current createRequestWakeTick behavior, including optional build-intent classification). So "wake abstraction" here means: one function that both sets wake state and triggers the scheduler, used by all callers.
3. Replace direct store writes and `requestWakeTick` call sites with **`requestWake(reason, message?)`** (or keep one name). Ensure error handler, chat handler, and any soul-tick scheduling path use it.

**Files:** `agent.ts`, optionally a small `wake.ts` or `requestWake.ts`; store unchanged or minimal (if Option B, add wake state).

---

## 4. Fast-tick (50 ms) handler list

**Goal:** Add or reorder 50 ms behaviors without editing the core loop.

**Steps:**

1. Define a **handler type**, e.g. `FastTickHandler = (ctx: { client; store; config; now: number }) => void`. Optionally allow async; current handlers are sync. Keep `now = Date.now()` so handlers don’t each call it.
2. Create a **list** of handlers (e.g. in agent.ts or a dedicated `fastTick.ts`):
   - `(ctx) => checkBreak(ctx.store, ctx.now, { occupants: ctx.store.getState().occupants, ownerUserId: ctx.config.ownerUserId, lastTriggerUserId: ctx.store.getState().lastTriggerUserId, maxRounds: CONVERSATION_MAX_ROUNDS })`
   - `(ctx) => autonomousManager.tick(ctx.client, ctx.store, ctx.config)`
   - `(ctx) => movementDriverTick(ctx.client, ctx.store, { voiceId: ctx.config.voiceId })`
   - `(ctx) => { const p = drainPendingReply(ctx.store); if (p) sendDmAndTransition(ctx.client, ctx.store, p.text, p.targetSessionId, ctx.config.voiceId); }`
3. Replace the current `setInterval` body with: `const now = Date.now(); for (const h of fastTickHandlers) { try { h({ client, store, config, now }); } catch { /* ignore */ } }`. Pass `client`, `store`, `config` from closure (or from a context object created once).
4. Document that new subsystems (e.g. heartbeat, periodic sync) add a handler to this list. Optionally allow registering handlers from config or from other modules (e.g. push to array); for now a single exported array is enough.

**Files:** `agent.ts`; optionally `src/lib/agent/fastTick.ts` with the handler type and array (and import from agent).

---

## 5. Explicit TickScheduler

**Goal:** Replace refs and ad-hoc coordination with one object that encapsulates "is tick running," "schedule next," and "request wake."

**Steps:**

1. Define **TickScheduler** (class or object with methods) in a small module (e.g. `scheduling.ts` next to `getNextTickDelay`):
   - **State:** `tickInProgress: boolean`, `tickScheduledId: ReturnType<typeof setTimeout> | null`, `wakeAfterTick: boolean`.
   - **Methods:**
     - `isTickRunning(): boolean`
     - `setTickRunning(running: boolean): void` (used by the loop: set true before runTick, false in finally).
     - `scheduleNextTick(delayMs: number | null): void` — clear any existing timeout; if `delayMs !== null`, set `tickScheduledId = setTimeout(callback, delayMs)`. Callback is provided at construction or when starting the loop (e.g. `runTickThenScheduleNext`).
     - `cancelNextTick(): void` — clear timeout, set tickScheduledId to null.
     - `requestFollowUp(): void` — set wakeAfterTick true (used when a wake happens and tick is already running).
     - `consumeFollowUp(): boolean` — return current wakeAfterTick and set it to false (used in finally).
2. **Construction:** Scheduler is created with a reference to `runTickThenScheduleNext` (or the scheduler holds the callback and the loop invokes it). So: `const scheduler = createTickScheduler(runTickThenScheduleNext)` or `new TickScheduler(runTickThenScheduleNext)`.
3. In **agent.ts**: Create one scheduler. In `runTickThenScheduleNext`: if `scheduler.isTickRunning()` return; else `scheduler.setTickRunning(true)`; run `runTick(...).finally(() => { scheduler.setTickRunning(false); const needImmediate = scheduler.consumeFollowUp(); ... delay = getNextTickDelay(store.getState(), config, { needImmediateFollowUp: needImmediate }); scheduler.scheduleNextTick(delay); })`. Replace `wakeAfterTickRef` with `scheduler.requestFollowUp()` and `tickScheduledRef` with `scheduler.scheduleNextTick` / `scheduler.cancelNextTick`. `createRequestWakeTick` receives the scheduler and calls `scheduler.requestFollowUp()` when tick is running, and `scheduler.scheduleNextTick(0)` (or a small delay) when debounce fires and tick is not running; optionally scheduler exposes `runNow()` that cancels next and invokes the tick callback.
4. Add tests for scheduler: e.g. scheduleNextTick clears previous timeout; consumeFollowUp returns and clears flag; requestFollowUp when running sets follow-up, and next tick runs immediately after (delay 0).

**Files:** `scheduling.ts` (or `tickScheduler.ts`), `agent.ts`, tests.

---

## 6. (Optional) Split "after tick" side effects from scheduling

**Goal:** So that "when to run next" depends only on state and policy, not on who updated the state.

**Steps:**

1. Identify all **state updates** that currently happen in the `.finally()` block or immediately after runTick (e.g. clearing wake flags are inside runTick; the only "after tick" side effect in agent today is possibly `setAutonomousSoulTickDue(true)` when we decide to schedule a soul tick). So today the split is minimal: getNextTickDelay already takes state; the only mutation in "after tick" in agent is that one setAutonomousSoulTickDue.
2. **Option A:** Leave as-is: getNextTickDelay is pure except the caller (agent) sets soul-tick due when policy returns soul delay. No separate "afterTick(store, result)" function.
3. **Option B:** Introduce **afterTick(store, tickResult?, opts)** that performs any post-tick updates (e.g. clear wake flags, set soul tick due) and returns nothing; the scheduler then calls `getNextTickDelay(store.getState(), ...)` so delay is computed from already-updated state. That way all "what changed after a tick" lives in one place. Current code already clears most flags inside runTick; the only cross-cutting one is soul-tick due. So afterTick could be "if we’re about to schedule a soul tick, setAutonomousSoulTickDue(true)" and getNextTickDelay stays pure (returns delay; agent or afterTick does the set). Prefer Option A unless you add more after-tick side effects.

**Files:** `agent.ts`, optionally `tickRunner.ts` or `scheduling.ts` if you add afterTick.

---

## Implementation order

| Step | Improvement              | Rationale |
|------|--------------------------|-----------|
| 1    | getNextTickDelay         | Small, high value; no refactor of runTick. |
| 2    | computeTickIntent + switch | Shrinks runTick and makes new phases easy. |
| 3    | Fast-tick handler list   | Independent; quick to add. |
| 4    | TickScheduler            | Cleaner agent; do after 1 so policy is already extracted. |
| 5    | Wake abstraction         | Unify call sites; can build on scheduler. |
| 6    | After-tick split         | Optional; do only if you add more after-tick logic. |

Suggested sequence: **1 → 2 → 3 → 4 → 5**, then **6** only if needed.

---

## Acceptance criteria

- **Policy:** All "when to run next" logic lives in `getNextTickDelay`; unit tests cover every branch.
- **Intent:** Every tick path goes through `computeTickIntent` and a single switch; new phase = new intent kind + handler.
- **Wake:** All wake sources call one API (`requestWake` or `requestWakeTick`); no direct store writes for wake from chat/error/soul.
- **Fast loop:** 50 ms behavior is a list of handlers; adding a handler doesn’t require editing the loop body.
- **Scheduler:** No raw refs for tick progress, next timeout, or follow-up; TickScheduler is the single abstraction and is unit tested.
- **Optional:** After-tick state updates are explicit (e.g. afterTick or documented in one place) and getNextTickDelay is pure.

---

## Files to add or touch

| File                    | Action |
|-------------------------|--------|
| `src/lib/agent/scheduling.ts` (or same name under agent) | Add `getNextTickDelay`, optionally `TickScheduler`. |
| `src/lib/agent/tickRunner.ts`                            | Add `TickIntent`, `computeTickIntent`; refactor `runTick` to switch on intent. |
| `src/lib/agent/agent.ts`                                 | Use getNextTickDelay; use TickScheduler; use fast-tick list; use wake API. |
| `src/lib/agent/fastTick.ts` (optional)                    | Handler type + handler array. |
| `src/lib/agent/wake.ts` or inline in agent (optional)    | requestWake / shared wake logic. |
| `*.test.ts`                                              | scheduling (getNextTickDelay, TickScheduler), tickRunner (computeTickIntent). |
