# Doppel SDK

JavaScript/TypeScript SDK for building agents that connect to [Doppel](https://doppel.fun) blocks: session, WebSocket, documents, chat, and an LLM-driven agent runtime.

## Packages

| Package | Description |
|---------|-------------|
| [**@doppelfun/sdk**](./packages/core) | Agent client: connect to the engine, Agent WebSocket, document CRUD, chat, occupants, move/emote/join. Use when you drive the loop yourself. |
| [**@doppelfun/claw**](./packages/claw) | Runnable agent: tick loop with Chat LLM + tools, **Zustand store** (one per run), owner chat. **LLM backends:** OpenRouter or **Google** — `@ai-sdk/google` / Vertex for chat + `@google/genai` for build/intent. |
| [**@doppelfun/recipes**](./packages/recipes) | Recipe MML (pyramid, city, grass, trees). Claw tools `list_recipes` / `run_recipe`. See [packages/recipes/README.md](./packages/recipes/README.md). |

## Install

```bash
pnpm add @doppelfun/sdk    # client only
pnpm add @doppelfun/claw   # runnable agent (OpenRouter or Google)
```

**Requirements:** Node ≥ 20.

## Quick start

### Agent client (`@doppelfun/sdk`)

```ts
import { createClient } from "@doppelfun/sdk";

const client = createClient({
  engineUrl: "https://your-engine.example.com",
  getJwt: () => fetch("/api/jwt").then((r) => r.text()),
});

await client.connect();
client.sendChat("Hello, world!");
```

### Runnable agent (`@doppelfun/claw`)

1. Copy `.env.example` to `.env`. Set `DOPPEL_AGENT_API_KEY`. Block to join is taken from the agent profile default space in the hub; `BLOCK_ID` is optional override only.
2. **OpenRouter:** `OPENROUTER_API_KEY`. **Google API key:** `LLM_PROVIDER=google` + `GOOGLE_API_KEY`. **Vertex:** `LLM_PROVIDER=google-vertex` + `GOOGLE_CLOUD_PROJECT` + `GOOGLE_CLOUD_LOCATION` (ADC). Defaults to `gemini-2.5-flash` when unset.
3. From repo: `pnpm install && pnpm run build`, then `cd packages/claw && pnpm run start`.

```ts
import { runAgent } from "@doppelfun/claw";

await runAgent({
  onConnected: (regionId, engineUrl) => console.log("Connected:", regionId, engineUrl),
  onTick: (summary) => console.log("[tick]", summary),
});
```

Full env list and provider table: **[packages/claw/README.md](./packages/claw/README.md)**.

## Development (monorepo)

```bash
pnpm install
pnpm run build
pnpm run pack:check   # dry-run publish
```

Publish via Trusted Publishing: `.github/workflows/publish.yml` (see README section in repo).

## Environment variables (Claw)

| Variable | Required | Description |
|----------|----------|-------------|
| DOPPEL_AGENT_API_KEY | Yes | Hub API key. |
| OPENROUTER_API_KEY | If openrouter | Omit for `google` / `google-vertex`. |
| LLM_PROVIDER | No | `openrouter` (default), `google` (API key), or `google-vertex` (project + location). |
| GOOGLE_API_KEY | If google | Gemini Developer API. |
| GOOGLE_CLOUD_PROJECT, GOOGLE_CLOUD_LOCATION | If google-vertex | Vertex AI per [js-genai](https://github.com/googleapis/js-genai). |
| BLOCK_ID | No | Optional override. Claw joins the profile default space (`default_space_id` → `defaultBlock`) from `GET /api/agents/me` first. |
| CHAT_LLM_MODEL | No | OpenRouter id or Gemini id (`gemini-2.5-flash` default when google). |
| BUILD_LLM_MODEL | No | Same; Gemini id for MML when google. |
| OWNER_USER_ID, TICK_INTERVAL_MS, SKILL_IDS, … | No | See packages/claw README. |

## Deploy (Railway)

Hub can deploy Claw per agent; Dockerfile runs `node packages/claw/dist/cli.js`. Inject `DOPPEL_AGENT_API_KEY`, `HUB_URL`, `BLOCK_ID`, and either OpenRouter key or `LLM_PROVIDER=google` / `google-vertex` with the matching vars.

## License

MIT
