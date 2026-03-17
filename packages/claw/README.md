# DoppelClaw

**DoppelClaw** is a lightweight agent runtime that runs a single behaviour tree (Mistreevous) on a 50ms tick. Wakes—from chat (DM), cron, or an autonomous scheduler—decide whether the **Obedient** agent (user-driven) or **Autonomous** agent runs each tick. One loop, one tree, plug in your LLM and tools.

See [docs/PLAN-AGENT-WAKE-DRIVEN.md](docs/PLAN-AGENT-WAKE-DRIVEN.md) for the design.

## Usage

**Minimal (no hub):**
```ts
import { loadConfig, createClawStore, createRunner, handleChatMessage } from "@doppelfun/claw";

const config = loadConfig();
const store = createClawStore("0_0");
const loop = createRunner({ store, config, client: myClient });
loop.start();
myClient.onMessage("chat", (payload) => handleChatMessage(store, config, payload));
```

**With hub (profile + join block + credits):**
```ts
import {
  bootstrapAgent,
  createSession,
  createRunner,
  handleChatMessage,
  refreshBalance,
} from "@doppelfun/claw";

const { config } = await bootstrapAgent();  // fetches profile, applies voiceEnabled/soul/dailyCreditBudget
const session = await createSession(config, config.blockId!, { refreshBalance: true });
if (!session.ok) throw new Error(session.error);
const { store, jwt, engineUrl, blockSlotId } = session;

// Create @doppelfun/sdk client with engineUrl and jwt, connect, then:
const loop = createRunner({
  store,
  config,
  client: myClient,
  onUsageReportFailure: (msg) => console.warn(msg),
});
loop.start();
myClient.onMessage("chat", (payload) => handleChatMessage(store, config, payload));
```

When the agent sends TTS, call `reportVoiceUsageToHub(config, store, text.length)` so the hub can deduct voice credits. Without a `client`, the loop still ticks; Obedient and Autonomous are no-ops until you pass a client.

**CLI (run the agent from the command line):**
```bash
# Set DOPPEL_AGENT_API_KEY and optionally BLOCK_ID (or use profile default). Then:
pnpm build && pnpm start
# or: node dist/cli.js
# or link and run: doppel-claw
```
The CLI bootstraps, joins a block (from profile default or `BLOCK_ID`), connects the SDK client, wires chat → `handleChatMessage`, starts the runner and optional cron scheduler (if profile has `cronTasks`), then connects. Use `.env` for keys (dotenv loaded from cwd and package dir).

## LLM providers

Claw supports multiple LLM backends via `LLM_PROVIDER`. Use `CHAT_LLM_MODEL` and `BUILD_LLM_MODEL` to override default models per provider.

| Provider     | Env vars             | Default chat model         | Default build model   |
|--------------|----------------------|----------------------------|------------------------|
| **bankr**    | `BANKR_LLM_API_KEY`  | `claude-sonnet-4-20250514` | `claude-opus-4.6`     |
| google       | `GOOGLE_API_KEY`     | `gemini-3-flash-preview`   | `gemini-3.1-pro-preview` |
| openrouter   | `OPENROUTER_API_KEY` | `openrouter/auto`          | `openrouter/auto`     |

### Bankr (recommended for self-hosting)

**Best option for self-hosting.** Single gateway for Claude, Gemini, and GPT; pay with token launch fees or wallet balance (USDC, ETH, BNKR on Base). Cost tracking, auto top-up, and high availability with failover.

- **Env:** `LLM_PROVIDER=bankr`, `BANKR_LLM_API_KEY=bk_YOUR_API_KEY`
- **Docs:** [Bankr LLM Gateway](https://docs.bankr.bot/llm-gateway/overview) · [Supported models](https://docs.bankr.bot/llm-gateway/supported-models)
- **Credits:** Manage balance and API keys at [bankr.bot/llm](https://bankr.bot/llm)

### Google (Gemini)

Direct Gemini API via Google AI Studio.

- **Env:** `LLM_PROVIDER=google`, `GOOGLE_API_KEY=your_key`
- **Defaults:** chat `gemini-3-flash-preview`, build `gemini-3.1-pro-preview`

### OpenRouter

Single API for many models (Claude, Llama, etc.) via [OpenRouter](https://openrouter.ai). Combined with Privy or similar Account Abstraction wallet can enable auto-credit spend and top-up.

- **Env:** `LLM_PROVIDER=openrouter`, `OPENROUTER_API_KEY=your_key`
- **Defaults:** chat and build `openrouter/auto`

**Cron scheduler (optional):** If the hub profile includes `cronTasks` with `intervalMs`, use `startCronScheduler(store, getTasks, { checkIntervalMs })` so that when a task is due the scheduler calls `requestCronWake(store, task)`. The behaviour tree routes cron wakes to the Obedient agent.

## Recipes

The Obedient agent can generate MML via **recipes** from [@doppelfun/recipes](https://github.com/doppelfun/doppel-sdk/tree/main/packages/recipes). Recipes are pure generators (no LLM): params in → MML out. Claw wires two tools:

- **`list_recipes`** — No args. Returns available recipe names (e.g. `city`, `pyramid`, `grass`, `trees`) so the agent can choose before calling `run_recipe`.
- **`run_recipe`** — `kind` (city / pyramid / grass / trees), optional `documentMode` (new / replace / append), `documentId`, and `params` per recipe. For city, Claw passes the full catalog in `params.catalog`; the recipe parses it to buildings, vehicles, and traffic lights. Writes MML via the build document API (new document, or replace/append by id).

Recipes live in the recipes package; claw depends on `@doppelfun/recipes` and calls `listRecipes()` and `runRecipe()` in the tool handlers. For custom scenes the agent uses `build_full` / `build_incremental` instead. To generate a new 3D model from a text description the agent uses **`generate_catalog_model`** (prompt, optional name/category); the hub starts a text-to-3D job and returns jobId/catalogId—the agent can then use list_catalog and the new catalogId in build_full or run_recipe.

## Architecture

```mermaid
flowchart TB
  subgraph sources["Wake sources"]
    WS["WebSocket chat"]
    Cron["Cron scheduler"]
  end

  Store[("Store\nwakePending, pendingScheduledTask")]

  subgraph loop["50ms tick loop"]
    Step["behaviourTree.step()"]
  end

  subgraph tree["Behaviour tree (sequence → selector)"]
    Move["ExecuteMovementAndDrain"]
    Move --> Branch["Selector"]
    Branch --> O1{"Owner wake?"}
    O1 -->|yes| C1{"Enough credits?"}
    C1 -->|yes| Obedient["RunObedientAgent"]
    C1 -->|no| Clear["ClearWakeInsufficientCredits"]
    O1 -->|no| A1{"Autonomous wake?"}
    A1 -->|yes| C2{"Enough credits?"}
    C2 -->|yes| Autonomous["RunAutonomousAgent"]
    C2 -->|no| Clear
    A1 -->|no| T1{"Time for autonomous?"}
    T1 -->|yes| ReqAuto["RequestAutonomousWake"]
    T1 -->|no| Idle["ClearWakeIdle"]
  end

  WS -->|"handleChatMessage → requestWake('dm')"| Store
  Cron -->|"requestCronWake(task)"| Store
  ReqAuto --> Store
  Store --> Step
  Step --> Move
  Obedient --> LLM[("LLM + tools\n(chat, move, build/recipe tools)")]
  Autonomous --> LLM
```

## Exports

- **Loop:** `createAgentLoop`, `createRunner`, `createTreeAgent`, `TREE_DEFINITION`
- **Wake:** `requestWake`, `WakeType`, `WakePayload`
- **Handlers:** `handleChatMessage`, `ChatPayload` (wire WS chat → store + requestWake)
- **State:** `createClawStore`, `createInitialState`, `ClawState`, `ClawStore`, etc.
- **Config:** `loadConfig`, `ClawConfig`
- **Prompts:** `buildSystemContent`, `buildUserMessage`
- **Agents:** `runObedientAgentTick`, `runAutonomousAgentTick`
- **Build:** `createRunBuildStubTool` (from lib/build; Obedient uses direct build/recipe tools from the tool registry)
- **Hub:** `getAgentProfile`, `reportUsage`, `checkBalance`, `applyHubProfileToConfig`, `HubAgentProfile`
- **Credits:** `reportUsageToHub`, `reportVoiceUsageToHub`, `hasEnoughCredits`, `refreshBalance`, `MIN_BALANCE_THRESHOLD`
- **Cron:** `requestCronWake(store, task)`, `startCronScheduler(store, getTasks, options)` — tree routes cron to Obedient
- **Bootstrap:** `bootstrapAgent()`, `createSession(config, blockId, { refreshBalance })`, `getDefaultBlockId(profile, config, fallback)`

## Build

```bash
pnpm run build
```

## Tests

```bash
pnpm test
```
