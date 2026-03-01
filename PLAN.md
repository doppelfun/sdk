# Plan: Claw config, soul, skills, and agent server URL

This plan covers: (1) pulling skill files and soul from the API into the agent runner, (2) storing personality as a “soul” on agent create, (3) building the system prompt from base + soul + skills, and (4) storing the agent’s claw server URL for targeting (e.g. restart).

---

## 1. Backend (doppel-app)

### 1.1 Agent schema changes

- **`agent.soul`** (text, nullable)  
  Single “personality” block for the LLM. Distinct from `description` (display/bio).  
  Format when set: `"You are a helpful world builder agent with these personality traits: {trait1}, {trait2}."`

- **`agent.serverUrl`** (text, nullable)  
  Base URL of the server/process running this agent’s runtime (e.g. `https://agent-runner-abc.doppel.fun`). Used to target that server for restart, health checks, or future control APIs. Distinct from `space.serverUrl` (engine for a space).

- Add DB migration(s) for both columns.

### 1.2 Set soul on agent create (personality traits)

- **Where:** Create-space wizard path that creates a new agent: `POST /api/accounts/me/create-space` (and any other agent-creation path that collects personality).
- **Logic:** When inserting a new agent:
  - Keep `description` as today (e.g. `personalityTraits.slice(0, 2).join(", ")` for display).
  - Set `soul` when there is at least one trait:  
    `"You are a helpful world builder agent with these personality traits: " + personalityTraits.slice(0, 2).join(", ") + "."`  
  - Otherwise leave `soul` null.
- If agents are also created via `POST /api/agents/register` without personality, leave `soul` null there (or add optional `personalityTraits` / `soul` later).

### 1.3 Claw config API

- **New endpoint:** `GET /api/agents/me/claw-config` (Bearer API key).
- **Response:** `{ soul: string | null, skills: string, serverUrl: string | null }`
  - `soul`: from `agent.soul`.
  - `skills`: single concatenated string of skill file content (see 1.4), optionally filtered (see below).
  - `serverUrl`: from `agent.serverUrl` (so claw or dashboard can read it).
- Auth: reuse existing agent API-key auth (e.g. `getAgentFromRequest`).

**Skills filter (query params):** Allow the client to request which skills are included in `skills`.
- **Query params:** e.g. `skillIds=doppel,doppel-block-builder` or `skills=doppel&skills=doppel-block-builder` (list of skill identifiers). If omitted, return all skills the agent is entitled to (global and/or per-agent).
- **Behavior:** API resolves the set of skills (from global source and/or agent-scoped), then filters to the requested IDs if query params are present. Concatenate only the filtered set and return in `skills`. Invalid or unknown IDs are ignored (or return 400 if you prefer strict validation).
- **Claw use:** The SDK can pass e.g. `SKILL_IDS` env (comma-separated) or `runAgent({ skillIds: ['doppel'] })` so the fetch includes only those skills, reducing prompt size when not all skills are needed.

**Alternative:** Extend `GET /api/agents/me` with `soul`, `skills`, and `serverUrl` instead of a new endpoint. Prefer a dedicated `claw-config` if you want to keep profile and claw config separate.

### 1.4 Skill files source (API side)

- **v1:** No per-agent skills. `skills` is either empty or from a **global** source (e.g. markdown under `public/skills/` or a single global blob). API reads available skills, applies the optional filter from query params, concatenates the selected ones, and returns one string.
- **Later:** Per-agent skills (e.g. `agent_skill` table or `agent.skills` JSONB). Then `GET /api/agents/me/claw-config` resolves skills for the authenticated agent, applies the filter, and concatenates into `skills`.

### 1.5 Register/update claw server URL

- **Write:** Allow the runtime (or deployer) to set/update the agent’s runtime server URL.
  - **Option A:** `PATCH /api/agents/me` with body `{ serverUrl: string | null }` (agent auth). Validate URL format; update `agent.serverUrl`.
  - **Option B:** New `PUT /api/agents/me/claw-server` with body `{ url: string | null }`. Same auth and validation.
- **Read:** Expose `serverUrl` in `GET /api/agents/me` and in `GET /api/agents/me/claw-config` so the platform (and claw) can use it for restart/targeting.

### 1.6 Edit soul (owner, agent page)

- **API:** Allow the **account owner** of an agent to update `agent.soul` from the dashboard (session auth, not agent API key).
  - **Endpoint:** e.g. `PATCH /api/accounts/me/agents/[id]` with body `{ soul: string | null }`. Verify the agent belongs to the authenticated account (`agent.accountId === session.accountId`); return 403 if not. Optional: cap length and sanitize (e.g. max 2000 chars).
  - **Read:** Include `soul` in the response when the agent page fetches agent details for an owned agent (e.g. extend `GET /api/accounts/me/agents` list or `GET /api/agents/[id]` to return `soul` when the caller is the owner).
- **Agent page (doppel-app):** On the agent detail page (e.g. `/agents/[id]`), if the logged-in user **owns** the agent (e.g. agent is in “my agents” or `accountId` matches session):
  - Show a **Soul** section: current soul text in an editable textarea (or placeholder like “No soul set”) with a Save button.
  - On Save, call the PATCH endpoint with the new `soul` value; on success, update local state and optionally show a toast. Do not expose soul on the public agent profile if you want it to be owner-only (public `GET /api/agents/[id]` can omit `soul`).

---

## 2. Claw (doppel-sdk)

### 2.1 Base URL for agent API

- Claw already has `HUB_URL` for join/create space. If the same app serves hub and agent APIs, use `HUB_URL` for the claw-config (and PATCH) requests.
- If hub and app differ, add env e.g. `AGENT_API_URL` (default `HUB_URL`) and use it for these calls. Document in README.

### 2.2 Fetch claw config at startup

- In `runAgent()` (after `loadConfig()`, before or after resolving JWT/engine):
  - `GET {baseUrl}/api/agents/me/claw-config` with `Authorization: Bearer {apiKey}`. Optionally append query params to filter skills (e.g. `?skillIds=doppel,doppel-block-builder` or `?skills=doppel&skills=doppel-block-builder` per API contract).
  - Parse `{ soul, skills, serverUrl }`.
  - On 4xx/5xx or network error: either fail startup or proceed with empty soul/skills and log a warning.
- Pass the result through (e.g. `clawConfig: { soul, skills, serverUrl }`) into the tick or prompt builder.
- **Skill filter:** Support optional config (e.g. env `SKILL_IDS` comma-separated or `runAgent({ skillIds: string[] })`) and pass through as query params so only requested skills are returned and injected into the prompt.

### 2.3 Build system message

- **Order:** base system prompt → soul → skills.
- Where the system content is built (e.g. in `agent.ts` or `prompts.ts`):
  - `systemContent = SYSTEM_PROMPT`
  - If `clawConfig.soul` is non-empty: append `"\n\n" + clawConfig.soul`
  - If `clawConfig.skills` is non-empty: append `"\n\n---\n\nSkills:\n\n" + clawConfig.skills`
- Use `systemContent` as the single system message in the Chat LLM call each tick. No change to tools or user message.

### 2.4 Register claw server URL at startup

- If the claw knows its own public base URL (e.g. env `CLAW_PUBLIC_URL` or `AGENT_SERVER_URL`), after startup call the write endpoint once to set `agent.serverUrl` (e.g. `PATCH /api/agents/me` or `PUT /api/agents/me/claw-server`).
- If not set (e.g. local dev), skip the update or leave existing DB value unchanged.

### 2.5 Config / env

- Add to `ClawConfig` and README as needed: base URL for agent API (if new), optional `CLAW_PUBLIC_URL` (or `AGENT_SERVER_URL`) for self-registration of claw server URL, and optional `SKILL_IDS` (comma-separated) to request only those skills from the claw-config API.

### 2.6 Optional: programmatic overrides

- Support `runAgent({ soul?: string, skills?: string, skillIds?: string[] })` (or `clawConfig?: { soul, skills }`) so callers can override or supply soul/skills without calling the API, or pass `skillIds` to filter which skills the API returns. Precedence: options > API. Useful for tests or custom runners.

---

## 3. Using claw server URL (restart, etc.)

- **Restart:** Backend or admin reads `agent.serverUrl`, then calls e.g. `POST {serverUrl}/restart` (or your chosen contract) with appropriate auth.
- **Health:** Same base URL for e.g. `GET {serverUrl}/health` if the claw exposes it.
- Index on `serverUrl` only if you need to query “all agents on this server”; otherwise optional.

---

## 4. Summary

| Area | Change |
|------|--------|
| **DB (doppel-app)** | Add `agent.soul` (text, nullable), `agent.serverUrl` (text, nullable); migrations. |
| **Create-space** | When creating agent, set `soul` from personality traits (sentence format). |
| **API (doppel-app)** | `GET /api/agents/me/claw-config` → `{ soul, skills, serverUrl }`; optional query filter for skills (e.g. `skillIds`); implement `skills` as global concatenation for v1. |
| **API (doppel-app)** | `PATCH /api/agents/me` or `PUT /api/agents/me/claw-server` to set/clear `serverUrl`; expose in GET /api/agents/me. |
| **API (doppel-app)** | `PATCH /api/accounts/me/agents/[id]` with `{ soul }` for owner to edit soul; return `soul` when fetching owned agent. |
| **Agent page (doppel-app)** | If user owns agent, show Soul section with editable textarea + Save; call PATCH to update. |
| **Claw (doppel-sdk)** | Fetch claw config at startup; build `systemContent = SYSTEM_PROMPT + soul + skills`; pass to Chat LLM each tick. |
| **Claw (doppel-sdk)** | Optionally register own base URL at startup via PATCH when `CLAW_PUBLIC_URL` (or similar) is set. |

No vector DB or embeddings; soul and skills are plain text concatenated into the system prompt.
