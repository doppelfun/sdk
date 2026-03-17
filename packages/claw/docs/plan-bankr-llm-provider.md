# Plan: Add Bankr LLM provider to Doppel SDK Claw

**Goal:** Support [Bankr LLM Gateway](https://docs.bankr.bot/llm-gateway/overview) as an LLM provider so Claw can use Claude, Gemini, GPT, etc. via `https://llm.bankr.bot` (OpenAI-compatible API), paid with launch fees or wallet balance.

**Reference:** Bankr exposes OpenAI-compatible `/v1/chat/completions`; auth via `X-API-Key: bk_YOUR_API_KEY`.

---

## 1. Config and types

**File:** `src/lib/config/config.ts`

- **Extend `LlmProviderId`:** Add `"bankr"` so the union is `"openrouter" | "google" | "google-vertex" | "bankr"`.
- **Extend `ClawConfig`:**
  - Add `bankrLlmApiKey: string | null` (or `string` with `""` when unset), same pattern as `openRouterApiKey` / `googleApiKey`.
- **Update `parseLlmProvider()`:** If `raw === "bankr"` return `"bankr"`.
- **Update `loadConfig()`:**
  - When `llmProvider === "bankr"`, require `BANKR_LLM_API_KEY` (or `BANKR_LLM_KEY`) and throw a clear error if missing.
  - Add to returned config: `bankrLlmApiKey: process.env.BANKR_LLM_API_KEY?.trim() || null` (and normalize empty string to null if you use `string | null`).
- **Default models for Bankr:** When `llmProvider === "bankr"`, set:
  - `defaultChatModel` (e.g. `"claude-sonnet-4-20250514"` or `"claude-opus-4.6"` from [Bankr supported models](https://docs.bankr.bot/llm-gateway/overview)).
  - `defaultBuildModel` (e.g. a stronger model like `"claude-opus-4.6"` or a Gemini/Codex variant if preferred).
  Use the same env pattern as today: `CHAT_LLM_MODEL` / `BUILD_LLM_MODEL` override these defaults.

**Optional:** Export a small constant for the Bankr base URL (e.g. `BANKR_LLM_BASE_URL = "https://llm.bankr.bot"`) if you want to reuse it in tests or docs.

---

## 2. New Bankr provider implementation

**File:** `src/lib/llm/providers/bankr.ts` (new)

- **Dependency:** Use the OpenAI-compatible API via `@ai-sdk/openai` with a custom base URL and custom headers (Bankr uses `X-API-Key`, not `Authorization: Bearer`).
- **Implementation:**
  - `createOpenAI({ baseURL, headers: { "X-API-Key": apiKey } })`.  
    - **Base URL:** `https://llm.bankr.bot/v1` (so the SDK’s path e.g. `chat/completions` is appended correctly; verify against [AI SDK OpenAI provider](https://sdk.vercel.ai/providers/ai-sdk-providers/openai) behavior).
  - **Auth:** Pass the Bankr API key only in `headers["X-API-Key"]`. If `@ai-sdk/openai` always sends `Authorization: Bearer` when `apiKey` is set, either:
    - Omit `apiKey` and rely only on `headers` (if the SDK allows), or  
    - Set `apiKey` to the same value and rely on Bankr accepting both (confirm in Bankr docs or with a quick test).
  - Caching: Optional singleton/cached provider instance (same pattern as `openrouter.ts` / `google.ts`) keyed by the configured API key if you want to avoid recreating the client.
  - Export: `getBankrLanguageModel(config: ClawConfig, modelId: string): LanguageModel | null` — return `provider.chat(modelId)` (cast to `LanguageModel` like OpenRouter/Google), or `null` if `config.bankrLlmApiKey` is missing/empty.

**Package:** Add `@ai-sdk/openai` to `package.json` dependencies in `packages/claw`.

---

## 3. Wire Bankr into the LLM provider factory

**File:** `src/lib/llm/provider.ts`

- Import `getBankrLanguageModel` from `./providers/bankr.js`.
- In `createLlmProvider(config)`, in the `getChatModel(modelId)` branch:
  - If `config.llmProvider === "bankr"`, return `getBankrLanguageModel(config, modelId)`.
- Keep existing branches for `google`, `openrouter`, and `google-vertex` unchanged.

---

## 4. Tests

- **Config:** In existing config tests (or new ones), assert that:
  - `LLM_PROVIDER=bankr` with `BANKR_LLM_API_KEY` set produces `llmProvider: "bankr"` and non-null `bankrLlmApiKey`.
  - `LLM_PROVIDER=bankr` without `BANKR_LLM_API_KEY` throws the expected error.
- **Provider:** Optional unit test for `getBankrLanguageModel` (e.g. returns `null` when key is missing; returns a model when key is set). Integration test against `https://llm.bankr.bot` only if you have a test key and want to assert end-to-end.

---

## 5. Documentation and env

- **README or env template:** Document:
  - `LLM_PROVIDER=bankr`
  - `BANKR_LLM_API_KEY` (required when using Bankr)
  - Optional: `CHAT_LLM_MODEL` / `BUILD_LLM_MODEL` for Bankr model ids (e.g. `claude-opus-4.6`, `gemini-2.0-flash`, etc.).
- **Link:** Point to [Bankr LLM Gateway Overview](https://docs.bankr.bot/llm-gateway/overview) and, if useful, [Supported Models](https://docs.bankr.bot/llm-gateway/supported-models) for model names and context windows.

---

## 6. Checklist summary

| Step | Task |
|------|------|
| 1 | Add `"bankr"` to `LlmProviderId` and `bankrLlmApiKey` to `ClawConfig` in `config.ts`. |
| 2 | Parse `LLM_PROVIDER=bankr` and require `BANKR_LLM_API_KEY` in `loadConfig()`. |
| 3 | Set default `chatLlmModel` / `buildLlmModel` when provider is `bankr`. |
| 4 | Add `@ai-sdk/openai` to `packages/claw` dependencies. |
| 5 | Create `src/lib/llm/providers/bankr.ts` using `createOpenAI` with Bankr base URL and `X-API-Key` header. |
| 6 | Register Bankr in `createLlmProvider()` in `provider.ts`. |
| 7 | Add config (and optional provider) tests. |
| 8 | Update README / env docs for Bankr. |

---

## 7. Bankr API quick reference

- **Base URL:** `https://llm.bankr.bot`
- **Chat completions:** `POST /v1/chat/completions` (OpenAI format)
- **Auth:** `X-API-Key: bk_YOUR_API_KEY`
- **Example model:** `claude-opus-4.6` (see [Supported Models](https://docs.bankr.bot/llm-gateway/supported-models) for full list)

No code changes are required to the chat/build handlers that already use `createLlmProvider(config)` and `getChatModel` / build model; they will automatically use Bankr when `config.llmProvider === "bankr"` and the corresponding model ids are set.
