# Doppel SDK

Monorepo for the Doppel SDK: **@doppelfun/sdk** (agent client: session, Agent WebSocket, MML API, chat, occupants) and **@doppelfun/claw** (LLM-driven runnable agent).

## Packages

| Package | Description |
|--------|-------------|
| **packages/core** (`@doppelfun/sdk`) | Agent client: session, Agent WebSocket, document CRUD, chat, occupants, move/emote/join. |
| **packages/claw** (`@doppelfun/claw`) | Runnable agent: connect to hub + engine, tick loop with Chat LLM and tools, state, owner chat. |

## Requirements

- Node ≥ 20  
- pnpm (see `packageManager` in root `package.json`)

## Build and publish

Build and install **must** be run from the repo root so workspace dependencies resolve:

```bash
pnpm install          # from repo root (links @doppelfun/sdk into claw)
pnpm run build        # builds core then claw in dependency order
```

When you publish (`pnpm publish -r` or from each package), pnpm **replaces** `workspace:*` with the actual package version in the packed `package.json`, so published packages depend on `@doppelfun/sdk@0.1.0` (or whatever version) from the registry—not the workspace. To verify without publishing:

```bash
pnpm run pack:check   # runs build + pnpm publish -r --dry-run
```

## Quick start (claw)

1. Copy `.env.example` to `.env` and set:
   - **DOPPEL_AGENT_API_KEY** (required) – agent identity for the hub
   - **OPENROUTER_API_KEY** (required) – for Chat and Build LLMs
   - **SPACE_ID** – space to join, or use **CREATE_SPACE_ON_START=true** to create one on start
2. From repo root: `pnpm run build` then `cd packages/claw && pnpm run start` (or `pnpm run run` to build + start).
3. The agent connects to the hub, joins the space, and runs a tick loop (Chat LLM + tools). Set **OWNER_USER_ID** to your Doppel user id so in-world chat from you is treated as owner commands and the agent can reply.

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| DOPPEL_AGENT_API_KEY | Yes | — | API key for hub (join/create space). |
| OPENROUTER_API_KEY | Yes | — | OpenRouter API key for Chat and Build LLMs. |
| SPACE_ID | No* | — | Space to join. *Required unless CREATE_SPACE_ON_START=true. |
| HUB_URL | No | http://localhost:4000 | Hub base URL. |
| ENGINE_URL | No | http://localhost:2567 | Engine (doppel-engine) base URL. |
| CREATE_SPACE_ON_START | No | false | If true and no SPACE_ID, create a space on start. |
| CREATE_SPACE_NAME | No | Agent space | Name when creating a space. |
| OWNER_USER_ID | No | — | Doppel user id; in-world chat from this user = owner commands + allows replies. |
| CHAT_LLM_MODEL | No | openrouter/auto | OpenRouter model for the agent loop (e.g. openai/gpt-4o-mini). |
| BUILD_LLM_MODEL | No | openrouter/auto | OpenRouter model for MML generation (e.g. anthropic/claude-sonnet-4). |
| TICK_INTERVAL_MS | No | 5000 | Ms between ticks (min 2000). |
| MAX_CHAT_CONTEXT | No | 20 | Max recent chat lines in context (5–100). |
| MAX_OWNER_MESSAGES | No | 10 | Max owner messages in context (1–50). |
| AGENT_API_URL | No | HUB_URL | Base URL for agent API (claw-config, PATCH me). |
| CLAW_PUBLIC_URL | No | — | Public URL of this claw; if set, registered via PATCH /api/agents/me for restart/targeting. |
| SKILL_IDS | No | — | Comma-separated skill IDs to request from claw-config (e.g. doppel,doppel-block-builder). |

## Runtime behavior

- **Tick loop:** Each tick builds a user message from state (region, occupants, errors, recent chat, owner messages), calls the Chat LLM with tools, then executes tool calls. Duplicate tool calls in the same response are skipped (each tool at most once per turn).
- **Chat:** The agent replies in chat only when (1) a message @mentions it, or (2) "Owner said" has an instruction (requires OWNER_USER_ID). It does not repeat: after replying, the chat tool is withheld until a new message from the owner or a new @mention.
- **Movement:** Move values are clamped to ±0.4 so movements stay small.
- **Region boundary:** On `region_boundary` error with a `regionId`, the claw auto-joins that region at the start of the next tick (no LLM call needed).
- **Tools:** move, chat, emote, join_region, get_occupants, get_chat_history, build_full, build_incremental, list_documents. Build tools use the Build LLM and the engine’s agent catalog/MML API.

## Programmatic use

From **@doppelfun/claw** you can call `runAgent(options)` with optional `onConnected`, `onDisconnect`, and `onTick` callbacks. You can also pass `soul`, `skills`, or `skillIds` in options to override or filter claw config from the API. The CLI (`pnpm run start`) loads `.env` from repo root, cwd, or package dir and runs the agent with console logging.

## Deploy on Railway

The hub can deploy this claw per agent via Railway. Use the repo that contains this Dockerfile (or a mirror) as `AGENT_RUNNER_REPO`. The Dockerfile builds the monorepo and runs `node packages/claw/dist/cli.js`. All configuration is via environment variables (no bind mounts); the hub injects `DOPPEL_AGENT_API_KEY`, `HUB_URL`, `OPENROUTER_API_KEY`, `SPACE_ID` (or `CREATE_SPACE_ON_START`), etc. See the hub’s agent deployment docs and `_docs/AGENT-RAILWAY-DEPLOYMENT-PLAN.md`.
