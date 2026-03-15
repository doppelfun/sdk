# AI SDK standardization audit

What’s already on the AI SDK and what else we can move over (within **doppel** only).

---

## Already on AI SDK

| Area | What | Where |
|------|------|--------|
| **Chat tick** | `ToolLoopAgent` + `generateText` with tools | `@ai-sdk/google`, `@ai-sdk/google-vertex`, `@openrouter/ai-sdk-provider` in claw |
| **OpenRouter build + intent** | `generateText` (complete), `generateObject` (classifyBuildIntent) | `openrouterProvider.ts` |
| **Model router** | `generateText` for TOOLS vs CONVERSATION | `modelRouter.ts` |
| **Voice (engine)** | `experimental_generateSpeech` + `@ai-sdk/elevenlabs` | `doppel-engine/.../voice/providers/elevenlabs.ts` |
| **Usage shape** | `usageFromAiSdk()` maps AI SDK usage → hub `Usage` | `usage.ts` |

---

## Can standardize (recommended)

### 1. **Claw: Google build + intent → AI SDK** (high value)

**Current:** `googleGenAiBase.ts` uses `@google/genai` for:

- `complete()` — build MML
- `classifyBuildIntent()` — wake intent

**Change:** Use the same pattern as OpenRouter:

- `complete()` → `generateText({ model: this.getChatModel(options.model), system, prompt, ... })` and `usageFromAiSdk(result.usage)`.
- `classifyBuildIntent()` → `generateObject({ model: this.getChatModel(modelId), schema: intentSchema, prompt, ... })` (same Zod schema as OpenRouter).

**Result:** One less dependency path; build/intent go through the same provider as chat. **Exception:** keep `@google/genai` only for `completeWithCodeExecution()` (Gemini Python sandbox); the AI SDK Google provider does not expose that tool, so that single method stays on the direct SDK.

---

### 2. **Engine: NPC Gemini → @ai-sdk/google** (optional)

**Current:** `npcGemini.ts` uses `@google/genai` for:

- Block theme (`getOrCreateBlockTheme`)
- Persona pool (`getOrCreateNpcPersonaPool`)
- NPC chat (`npcChatCompletion`)

**Change:** Add `@ai-sdk/google` and `@ai-sdk/google-vertex` to the engine server; use `createGoogleGenerativeAI` / `createVertex` and `generateText` (and optionally `generateObject` for JSON) instead of `GoogleGenAI.models.generateContent`. Same env vars (API key or project/location).

**Result:** Engine and claw share the same Google integration surface; you can remove `@google/genai` from the engine if you do this.

---

## Standardize with caveats

### 3. **Claw: `completeWithCodeExecution` (build_with_code)**

**Current:** Uses `@google/genai` with `tools: [{ codeExecution: {} }]` (Gemini’s built-in Python sandbox).

**Options:**

- **A. Leave as-is.** Keep this one path on `@google/genai`; everything else (chat, build, intent) on AI SDK.
- **B. Vercel Sandbox.** Use `ai-sdk-tool-code-execution` (Vercel Sandbox) with an AI SDK model (e.g. OpenAI or Gemini for the *text* part). Different product and cost model; not a drop-in for Gemini code execution.

Recommendation: **A** unless you explicitly want to move build_with_code off Gemini’s sandbox.

---

### 4. **Engine: Gemini TTS**

**Current:** `voice/providers/gemini.ts` uses a raw REST call to `generativelanguage.googleapis.com/.../generateContent` with `responseModalities: ["AUDIO"]`.

**AI SDK:** `experimental_generateSpeech` in the AI SDK currently supports OpenAI and ElevenLabs, not Gemini TTS. So there is no AI SDK API to “move to” for Gemini TTS today.

**Options:** Keep the current REST implementation, or standardize on ElevenLabs-only for TTS and treat Gemini TTS as a legacy path until the AI SDK adds Gemini speech support.

---

## Usage and types

- **Usage:** You already map AI SDK usage to a single `Usage` type and use it for hub reporting and cost. No change needed; keep using `usageFromAiSdk()` and your existing `Usage` type.
- **Cost:** `googleUsageCost.ts` can stay as-is; it already consumes the same `Usage` shape regardless of whether the call was made via AI SDK or `@google/genai`.

---

## Summary

| Item | Action | Notes |
|------|--------|--------|
| Google `complete()` + `classifyBuildIntent()` in claw | Move to AI SDK `generateText` / `generateObject` | Same pattern as OpenRouter; only code-exec stays on @google/genai |
| Engine npcGemini | Optionally move to @ai-sdk/google + `generateText` | Unifies engine + claw on same Google stack |
| `completeWithCodeExecution` | Keep on @google/genai | No AI SDK equivalent for Gemini code execution |
| Engine Gemini TTS | Keep as REST or drop | No AI SDK generateSpeech for Gemini yet |
| Usage/cost types | No change | Already aligned with AI SDK usage |

Implementing **§1 (Google build + intent in claw)** gives the biggest standardization win with minimal risk; **§2 (engine NPC)** is a clean follow-up if you want one Google integration path across repos.
