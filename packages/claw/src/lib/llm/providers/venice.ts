/**
 * Venice.ai — OpenAI-compatible chat completions API.
 * @see https://docs.venice.ai
 *
 * Venice rejects assistant turns with tool_calls and empty string content (AI SDK sends content: "").
 * We patch outgoing JSON to use a single space so the message "has content" without affecting tools.
 * @see https://github.com/vercel/ai/issues/13466 (same class of issue as Bedrock)
 */
import type { LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import type { ClawConfig } from "../../config/index.js";

const VENICE_API_BASE_URL = "https://api.venice.ai/api/v1";

/** Minimal non-empty text so Venice accepts assistant + tool_calls messages. */
const ASSISTANT_TOOL_ONLY_CONTENT_PLACEHOLDER = " ";

/** Exported for tests — mutates `body.messages` in place. */
export function patchChatCompletionsBodyForVenice(body: Record<string, unknown>): void {
  const messages = body.messages;
  if (!Array.isArray(messages)) return;
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    const m = msg as Record<string, unknown>;
    if (m.role !== "assistant") continue;
    const hasTools = Array.isArray(m.tool_calls) && m.tool_calls.length > 0;
    if (!hasTools) continue;
    const c = m.content;
    const empty =
      c === undefined ||
      c === "" ||
      (Array.isArray(c) && c.length === 0) ||
      (typeof c === "string" && c.trim() === "");
    if (empty) {
      m.content = ASSISTANT_TOOL_ONLY_CONTENT_PLACEHOLDER;
    }
  }
}

async function readRequestBodyAsString(body: BodyInit): Promise<string | null> {
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(body)) return body.toString("utf8");
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  if (body instanceof Blob) return body.text();
  if (body instanceof ReadableStream) {
    try {
      return await new Response(body).text();
    } catch {
      return null;
    }
  }
  return null;
}

/** Patches JSON chat/completions bodies before send so Venice accepts tool-only assistant messages. */
export async function veniceCompatibleFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  if (!init?.body) return fetch(input, init);
  const bodyStr = await readRequestBodyAsString(init.body as BodyInit);
  if (!bodyStr) return fetch(input, init);
  try {
    const parsed = JSON.parse(bodyStr) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      patchChatCompletionsBodyForVenice(parsed as Record<string, unknown>);
      return fetch(input, { ...init, body: JSON.stringify(parsed) });
    }
  } catch {
    return fetch(input, init);
  }
  return fetch(input, init);
}

let cachedProvider: ReturnType<typeof createOpenAI> | null = null;
let cachedApiKey: string | null = null;

function getProvider(apiKey: string): ReturnType<typeof createOpenAI> {
  if (!cachedProvider || cachedApiKey !== apiKey) {
    cachedProvider = createOpenAI({
      baseURL: VENICE_API_BASE_URL,
      apiKey,
      fetch: veniceCompatibleFetch,
    });
    cachedApiKey = apiKey;
  }
  return cachedProvider;
}

export function getVeniceLanguageModel(config: ClawConfig, modelId: string): LanguageModel | null {
  const apiKey = config.veniceApiKey?.trim();
  if (!apiKey) return null;
  const provider = getProvider(apiKey);
  return provider.chat(modelId) as unknown as LanguageModel;
}
