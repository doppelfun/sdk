# Plan: Refactor Doppel Claw to AI SDK ToolLoopAgent

## Overview

Refactor the Claw agent’s LLM integration to use the [AI SDK](https://ai-sdk.dev) **ToolLoopAgent** and recommended agent APIs instead of calling `generateText` directly. This aligns with the SDK’s documented [Building Agents](https://ai-sdk.dev/docs/agents/building-agents) and [Loop Control](https://ai-sdk.dev/docs/agents/loop-control) patterns and sets up type-safe agent usage (e.g. `InferAgentUIMessage`) for future UI or API consumers.

**Scope:** LLM/tool loop and agent definition. Higher-level tick structure (routing, evaluator–optimizer, build workflow) remains covered by [PLAN-WORKFLOW-PATTERNS.md](./PLAN-WORKFLOW-PATTERNS.md).

---

## Checklist

Check off as you complete each step. Use `[x]` when done.

### Provider packages (@ai-sdk/google and @openrouter/ai-sdk-provider)

- [x] Add `@openrouter/ai-sdk-provider` to claw dependencies; confirm Google uses only `@ai-sdk/google` / `@ai-sdk/google-vertex`.
- [x] Refactor `OpenRouterProvider` to use `@openrouter/ai-sdk-provider` (remove `createOpenAI` + baseURL).
- [x] Unify OpenRouter model access: shared helper used by provider and `toolsAi` fallback.
- [x] (Optional) Add `llm/providers/openrouter.ts` with `getOpenRouterLanguageModel(config, modelId)`.
- [x] Tests and typecheck pass for OpenRouter and Google.

### ToolLoopAgent refactor

- [x] Create agent module (`src/lib/agent/clawAgent.ts` or `src/lib/llm/clawAgent.ts`) with `createClawAgent(client, store, config)`.
- [x] Agent uses `prepareCall` (instructions override) and `prepareStep` (activeTools); lifecycle callbacks wired.
- [x] Export `ClawAgentUIMessage = InferAgentUIMessage<...>`.
- [x] Replace `runTickWithAiSdk` usage in `tickRunner.ts` with `agent.generate({ prompt: userContent })`; map result to `RunTickLlmResult` shape.
- [x] Keep or simplify fallback tool execution when provider doesn’t invoke `execute`.
- [x] Deprecate or remove direct `generateText` path in `toolsAi.ts` for the tick; tests use agent.
- [x] Tests and typecheck pass; README/docs updated.

---

## Provider packages: @ai-sdk/google and @openrouter/ai-sdk-provider

Standardize LLM backend on the official AI SDK provider packages:

- **@ai-sdk/google** – Use for Google Gemini (API key and Vertex). Claw already uses `@ai-sdk/google` (e.g. `createGoogleGenerativeAI`) and `@ai-sdk/google-vertex` (e.g. `createVertex`) in `GoogleGenAiApiProvider` and `GoogleGenAiVertexProvider`. The refactor should keep these as the sole Google backends for the ToolLoopAgent and model resolution (no custom or legacy paths).
- **@openrouter/ai-sdk-provider** – Use for OpenRouter instead of `createOpenAI` with `baseURL: "https://openrouter.ai/api/v1"`. The [@openrouter/ai-sdk-provider](https://www.npmjs.com/package/@openrouter/ai-sdk-provider) package provides first-class OpenRouter support for the AI SDK (e.g. `openrouter('openai/gpt-4o')`, extended options via `providerOptions.openrouter`). Replace the current OpenRouter path in `openrouterProvider.ts` and in `toolsAi.ts` (fallback model resolution) with the official provider so chat, build, and intent all go through the same OpenRouter integration.

**Current state:**

- **Google:** `GoogleGenAiApiProvider` uses `createGoogleGenerativeAI` from `@ai-sdk/google`; `GoogleGenAiVertexProvider` uses `createVertex` from `@ai-sdk/google-vertex`. No change to package choice; ensure ToolLoopAgent and `resolveTickLanguageModel` continue to use these.
- **OpenRouter:** `OpenRouterProvider` and the fallback in `toolsAi.ts` use `createOpenAI` from `@ai-sdk/openai` with `baseURL` and `apiKey`. No dedicated OpenRouter package.

**Target state:**

- **Google:** Unchanged packages; document that `@ai-sdk/google` and `@ai-sdk/google-vertex` are the only Google backends.
- **OpenRouter:** Add dependency `@openrouter/ai-sdk-provider`. In `OpenRouterProvider`: obtain the OpenRouter provider (e.g. `createOpenRouter` or equivalent from the package), call it with config (e.g. API key, optional base URL), and use it to get the chat model by model ID (e.g. `openrouter(modelId)` or the package’s documented API). Remove the `createOpenAI` + baseURL usage for OpenRouter. In `toolsAi.ts`, when falling back to OpenRouter, use the same provider factory or a shared helper so a single OpenRouter integration path exists. Update build/complete and classifyBuildIntent in `OpenRouterProvider` to use the same provider (generateText / generateObject with the OpenRouter model).

**Implementation steps (provider switch):**

1. Add `@openrouter/ai-sdk-provider` to `packages/claw` dependencies. Check the package’s README/API for AI SDK v6 (e.g. `openrouter()`, `createOpenRouter()`, or default export) and how to pass API key and optional options.
2. Refactor `OpenRouterProvider` to use the OpenRouter provider from the package instead of `createOpenAI` with baseURL. Implement `getChatModel(modelId)`, `complete()`, and `classifyBuildIntent()` using the new provider so behavior (and usage/cost handling) is preserved.
3. In `toolsAi.ts`, remove any direct `createOpenAI` + OpenRouter baseURL usage for the fallback model; use the same OpenRouter provider (e.g. from a shared `getOpenRouterModel(config, modelId)` helper used by both `OpenRouterProvider` and the fallback).
4. Optionally add a small `llm/providers/openrouter.ts` (or extend provider.ts) that exports `getOpenRouterLanguageModel(config, modelId)` used by both the provider and toolsAi, so OpenRouter is configured in one place.
5. Run tests and typecheck; confirm OpenRouter and Google paths still work with the ToolLoopAgent refactor.

---

## Reference (AI SDK)

- **Building Agents:** https://ai-sdk.dev/docs/agents/building-agents  
- **Agents Overview:** https://ai-sdk.dev/docs/agents/overview  
- **Loop Control:** https://ai-sdk.dev/docs/agents/loop-control (stopWhen, prepareStep)  
- **Workflow Patterns:** https://ai-sdk.dev/docs/agents/workflows  

Local API (verify against installed `ai` when implementing):

- `ToolLoopAgent` – class in `ai`; constructor takes `ToolLoopAgentSettings`.
- `agent.generate({ prompt })` / `agent.stream({ prompt })` – single entry per tick; loop runs inside the SDK.
- `prepareCall` – optional; runs once per `generate()`/`stream()`; can override `prompt`, `messages`, `instructions` (system).
- `prepareStep` – optional; runs before each step in the loop; can return `activeTools`, `toolChoice`, `model`, `messages`, `system`.
- `stopWhen` – e.g. `stepCountIs(n)` or custom `StopCondition`; default is `stepCountIs(20)`.
- Lifecycle: `onFinish`, `onStepFinish`, `experimental_onToolCallStart`, `experimental_onToolCallFinish`, etc.
- `InferAgentUIMessage<typeof agent>` – for type-safe `useChat` / UI messages.

---

## Current State

| Piece | Current behavior |
|-------|------------------|
| **LLM entry** | `runTickWithAiSdk(client, store, config, systemContent, userContent, onToolResult?, sdkOptions?)` in `toolsAi.ts`. |
| **Model** | `resolveTickLanguageModel(config)` – gateway or provider (e.g. Google). |
| **Tools** | `buildClawToolSet(client, store, config, { omitChat?, allowOnlyTools?, onToolResult? })` – full set or filtered (omit chat, build-only). |
| **Call** | `generateText({ model, system: systemContent, prompt: userContent, tools, toolChoice: 'auto', maxOutputTokens, temperature, stopWhen: stepCountIs(MAX_LLM_STEPS_PER_TICK) })`. |
| **Lifecycle** | Manual: wrap `onToolResult` to count executions; after `generateText`, check `hadToolCalls` and `executedCount`; if `executedCount === 0`, run fallback tool execution from `result.toolCalls` / `result.steps`. |
| **Post-LLM** | In `tickRunner.ts`: DM/error fallbacks, usage reporting, store updates (`pushLastTickToolName`, `clearMustActBuild`, etc.) based on result. |

So today we own the “agent loop” ourselves (one `generateText` with multi-step `stopWhen`) and implement fallback execution and callbacks by hand.

---

## Target State

- **Single agent definition** – One `ToolLoopAgent` (or a factory that returns one) that holds:
  - `model` from `resolveTickLanguageModel(config)` (or a default; see “Per-tick vs single agent” below).
  - `instructions` – base system content (soul, skills, rules); dynamic suffix (e.g. `MUST_ACT_BUILD_SUFFIX`) applied via `prepareCall` or `prepareStep`.
  - `tools` – full Claw tool set built with `(client, store, config)` and optional `onToolResult` wired to store/logging.
  - `stopWhen: stepCountIs(MAX_LLM_STEPS_PER_TICK)` (or same value by name).
  - `prepareStep` – reads `store.getState()` to return `activeTools` (and optionally `toolChoice`) so we get “omit chat” and “build-only” behavior without building a new tool map per tick.
  - Lifecycle callbacks – use `onStepFinish` / `onFinish` (and optionally `experimental_onToolCallStart` / `experimental_onToolCallFinish`) for logging, usage, and store updates instead of ad-hoc logic after `generateText`.

- **Per-tick invocation** – Instead of `runTickWithAiSdk(..., systemContent, userContent, ...)`:
  - Call `clawAgent.generate({ prompt: userContent })` (and optionally pass overrides via `prepareCall` for this tick, e.g. system suffix for must_act_build).
  - No direct `generateText` in our tick path; the agent encapsulates the loop.

- **Tool execution** – Rely on the SDK’s execution of tool `execute()` inside the agent loop. If the provider (e.g. Google) still does not invoke `execute`, keep a **fallback execution path** that runs tool calls from the final result when no tool was executed (same idea as today), or document that we require a provider that respects tool execution.

- **Type safety** – Export `ClawAgentUIMessage = InferAgentUIMessage<typeof clawAgent>` (or from the factory’s return type) for future use with `useChat` or API routes using `createAgentUIStreamResponse`.

---

## Design Choices

### Per-tick vs single agent instance

- **Single agent instance:** Create the agent once (e.g. when the Claw process or session starts) with `model`, `instructions`, `tools` closed over `(client, store, config)`. Each tick calls `agent.generate({ prompt: userContent })`. System content that changes per tick (e.g. must_act_build suffix) can be injected via `prepareCall` returning `instructions: baseInstructions + (state.tickPhase === 'must_act_build' ? MUST_ACT_BUILD_SUFFIX : '')`.
- **Factory per tick:** Create a new `ToolLoopAgent` each tick with the right `instructions` and tool set. Simpler mental model but more allocations; the SDK encourages a single agent and `prepareCall`/`prepareStep` for dynamic behavior.

**Recommendation:** Single agent instance (or one per “session”) with `prepareCall` and `prepareStep` for per-tick customization.

### Where the agent is created

- **Option A – `toolsAi.ts`:** Add `createClawAgent(client, store, config)` that returns a `ToolLoopAgent`; keep `buildClawToolSet` (or inline it inside the factory) and use it as the agent’s `tools`. `tickRunner` (or a thin wrapper) calls `createClawAgent(...).generate({ prompt: userContent })` instead of `runTickWithAiSdk`.
- **Option B – Dedicated module:** New file e.g. `src/lib/agent/clawAgent.ts` (or `src/lib/llm/clawAgent.ts`) that imports tools, model resolution, and config; exports `createClawAgent` and optionally `ClawAgentUIMessage`. `toolsAi.ts` then only contains tool definitions and `executeTool` wiring; the “agent” lives in one place.

**Recommendation:** Option B for a clear “agent definition” boundary and to match the AI SDK convention of defining the agent in one place.

### prepareCall vs prepareStep for dynamic system and tools

- **System (instructions):** Can be set in the constructor (static) or overridden per call via `prepareCall` (e.g. append must_act_build suffix when `store.getState().tickPhase === 'must_act_build'`).
- **Tools (full vs omit chat vs build-only):** The SDK supports `activeTools` in `prepareStep` to limit which tools are available per step without changing the declared tool set. So we can declare the full tool set on the agent and use `prepareStep` to return `activeTools` (and optionally `toolChoice: 'required'` for build-only) based on `store.getState()` (e.g. `lastTickSentChat` → omit chat; `tickPhase === 'must_act_build'` → build-only list).

**Recommendation:** Use `prepareCall` for per-tick `instructions` override (and to pass through `prompt`). Use `prepareStep` for `activeTools` (and optional `toolChoice`) so we don’t rebuild the tool map each tick.

### Fallback tool execution

- Today we run tool calls manually when `hadToolCalls && executedCount === 0`. The ToolLoopAgent still uses `generateText` under the hood; if the provider never calls `execute`, the same situation can occur.
- **Recommendation:** Keep a fallback path after `agent.generate()`: if the result has tool calls but no tool was executed (e.g. inferred from `onStepFinish` / `onFinish` or a counter), run the same fallback execution logic we have today. Optionally gate this behind a config flag or only enable for known providers (e.g. Google).

### Lifecycle and store updates

- Move “on tool result” side effects (e.g. `pushLastTickToolName`, clearing `must_act_build`, DM ack) into the agent’s lifecycle callbacks:
  - `experimental_onToolCallFinish` or `onStepFinish` – update store with tool name and result; clear build phase when a build tool succeeds.
  - `onFinish` – report usage, set “last tick had tool calls” or similar so the rest of the tick (e.g. evaluator–optimizer in PLAN-WORKFLOW-PATTERNS) can decide fallback reply.
- This keeps “what happened in the agent” inside the agent’s API and avoids duplicating logic in `tickRunner`.

---

## Implementation Steps

0. **Switch to @ai-sdk/google and @openrouter/ai-sdk-provider (provider packages)**
   - Add `@openrouter/ai-sdk-provider` to claw dependencies; keep `@ai-sdk/google` and `@ai-sdk/google-vertex` as the only Google backends.
   - Refactor `OpenRouterProvider` to use the OpenRouter provider from the package (e.g. `openrouter(modelId)` with API key from config); remove `createOpenAI` + baseURL for OpenRouter.
   - Unify OpenRouter model access (e.g. shared `getOpenRouterLanguageModel(config, modelId)`) so `toolsAi` fallback and the provider use the same integration. Run tests and typecheck.

1. **Create agent module**
   - Add `src/lib/agent/clawAgent.ts` (or `src/lib/llm/clawAgent.ts`).
   - Dependencies: model from `resolveTickLanguageModel`, base system content (from existing `buildSystemContent` or equivalent), `buildClawToolSet` (or equivalent) for `tools`, `stepCountIs`, `MAX_LLM_STEPS_PER_TICK`.
   - Export `createClawAgent(client, store, config): ToolLoopAgent` that:
     - Builds the full tool set with an `onToolResult` that updates store and optionally calls a passed-in callback.
     - Sets `instructions` to base system content.
     - Sets `model` from config.
     - Sets `stopWhen: stepCountIs(MAX_LLM_STEPS_PER_TICK)`.
     - Sets `prepareCall` to accept per-tick options and, if needed, override `instructions` with must_act_build suffix when `store.getState().tickPhase === 'must_act_build'`.
     - Sets `prepareStep` to return `activeTools` (and optionally `toolChoice`) from current state (omit chat when `lastTickSentChat`; build-only when in must_act_build).
     - Wires lifecycle callbacks for logging and store updates (tool names, clear must_act_build, usage).
   - Export type `ClawAgentUIMessage = InferAgentUIMessage<ReturnType<typeof createClawAgent>>` (or equivalent) for future use.

2. **Replace runTickWithAiSdk usage**
   - In `tickRunner.ts`, obtain the agent (from a cached instance or by calling `createClawAgent(client, store, config)` once per run/session).
   - For the LLM tick path, build `userContent` as today (e.g. `buildUserMessage(store.getState(), ...)`); then call `agent.generate({ prompt: userContent })` instead of `runTickWithAiSdk(...)`.
   - Map the result of `agent.generate()` to the same shape expected by the rest of the tick (e.g. `RunTickLlmResult`) so that reply evaluation and fallbacks in `tickRunner` (or in the workflow “respond” step) still work (e.g. `result.text`, `result.toolCalls` / steps, usage).

3. **Keep or simplify fallback execution**
   - After `agent.generate()`, if we detect that the result had tool calls but no tool was actually executed (e.g. via a counter in lifecycle callbacks), run the existing fallback execution logic (iterate tool calls from result, call `executeTool`, apply store updates). Optionally restrict to specific providers.

4. **Deprecate or remove direct generateText in toolsAi**
   - Once the tick path uses `agent.generate()`, remove or narrow `runTickWithAiSdk` (e.g. keep it only for tests or as a thin wrapper around the agent). Ensure tests that relied on `runTickWithAiSdk` now use the agent.

5. **Tests and types**
   - Add or update tests that create the agent and call `agent.generate({ prompt: ... })` with mocked client/store/config; assert on tool execution, `prepareStep` behavior (activeTools), and lifecycle.
   - Run typecheck and fix any type errors (e.g. `InferAgentUIMessage` with the actual agent type).

6. **Documentation**
   - Update README or internal docs to state that Claw uses the AI SDK `ToolLoopAgent` for the LLM loop; link to PLAN-WORKFLOW-PATTERNS for routing, evaluator–optimizer, and build workflow.
   - In code, add a short comment in `clawAgent.ts` pointing to [Building Agents](https://ai-sdk.dev/docs/agents/building-agents) and [Loop Control](https://ai-sdk.dev/docs/agents/loop-control).

---

## File Sketch

- **`src/lib/agent/clawAgent.ts`** (new) – `createClawAgent(client, store, config)`, lifecycle wiring, `prepareCall` / `prepareStep`, export `ClawAgentUIMessage`.
- **`src/lib/llm/toolsAi.ts`** – Keep `buildClawToolSet`, `executeTool` wiring, and tool definitions; remove or reduce `runTickWithAiSdk` to a thin wrapper or delete once callers use the agent. Use shared OpenRouter model helper (no direct `createOpenAI` + baseURL for OpenRouter). Optionally keep fallback execution in a small helper used by `clawAgent` or `tickRunner`.
- **`src/lib/llm/providers/openrouterProvider.ts`** – Use `@openrouter/ai-sdk-provider` instead of `@ai-sdk/openai` with baseURL; same `LlmProvider` interface.
- **`src/lib/llm/providers/openrouter.ts`** (optional) – Shared `getOpenRouterLanguageModel(config, modelId)` for the provider and toolsAi fallback.
- **`src/lib/agent/tickRunner.ts`** – Use `createClawAgent(...).generate({ prompt: userContent })` (or cached agent) in the LLM tick path; keep boundary handling, intent routing, build procedural/LLM handlers, and reply evaluation/fallback as today (or as refactored in PLAN-WORKFLOW-PATTERNS).
- **Google providers** – No package change; `GoogleGenAiApiProvider` and `GoogleGenAiVertexProvider` continue to use `@ai-sdk/google` and `@ai-sdk/google-vertex`.

---

## Success Criteria

- **Providers:** Google paths use only `@ai-sdk/google` and `@ai-sdk/google-vertex`; OpenRouter uses `@openrouter/ai-sdk-provider` only (no `createOpenAI` + baseURL for OpenRouter). One shared OpenRouter model path for the provider and toolsAi fallback.
- Claw’s LLM loop is driven by a single `ToolLoopAgent` instance (or factory) with tools, model, and stop condition defined in one place.
- Per-tick behavior (system suffix, omit chat, build-only tools) is achieved via `prepareCall` and `prepareStep` without rebuilding the full tool set each tick.
- Lifecycle (tool execution, store updates, usage) is handled via agent callbacks; no duplicate logic in the tick runner for “what tools ran.”
- Fallback tool execution is retained for providers that don’t invoke `execute`, with minimal code paths.
- Type `ClawAgentUIMessage` is exported for future `useChat` or API route use.
- Existing behavior (multi-step tool loop, must_act_build, reply fallbacks, movement/waypoints, conversation) is preserved; only the LLM entry point and agent shape change.
- Tests and typecheck pass; README or docs updated.

---

## References

- [AI SDK – Building Agents](https://ai-sdk.dev/docs/agents/building-agents)
- [AI SDK – Agents Overview](https://ai-sdk.dev/docs/agents/overview)
- [AI SDK – Loop Control](https://ai-sdk.dev/docs/agents/loop-control)
- [AI SDK – Workflow Patterns](https://ai-sdk.dev/docs/agents/workflows)
- [@openrouter/ai-sdk-provider](https://www.npmjs.com/package/@openrouter/ai-sdk-provider) – OpenRouter for AI SDK
- [OpenRouter – Vercel AI SDK](https://openrouter.ai/docs/community/vercel-ai-sdk)
- `docs/PLAN-WORKFLOW-PATTERNS.md` – Routing, evaluator–optimizer, build workflow, movement, conversation
- `src/lib/agent/TICK_LOOP_PLAN.md` – Tick scheduling, wake, fast-tick
