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

/** Strips optional ```json … ``` wrapper some models emit around tool JSON. */
function stripAssistantToolJsonFence(content: string): string {
  let t = content.trim();
  if (!t.startsWith("```")) return t;
  const firstNl = t.indexOf("\n");
  if (firstNl === -1) return t;
  t = t.slice(firstNl + 1);
  const end = t.lastIndexOf("```");
  if (end !== -1) t = t.slice(0, end);
  return t.trim();
}

type ToolCallShape = { id: string; type: "function"; function: { name: string; arguments: string } };

function newToolCallId(index: number): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `call_${crypto.randomUUID()}`;
  }
  return `call_venice_${index}_${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Venice sometimes returns tool invocations as JSON in `message.content` instead of `tool_calls`.
 * The AI SDK then surfaces that as plain text. Normalize to OpenAI-style tool_calls so tools run.
 */
export function patchChatCompletionsResponseFromVenice(data: Record<string, unknown>): Record<string, unknown> {
  const choices = data.choices;
  if (!Array.isArray(choices) || choices.length === 0) return data;
  let anyChanged = false;
  const newChoices = choices.map((choice, choiceIdx) => {
    if (!choice || typeof choice !== "object") return choice;
    const ch = choice as Record<string, unknown>;
    const msg = ch.message;
    if (!msg || typeof msg !== "object") return choice;
    const m = msg as Record<string, unknown>;
    if (m.role !== "assistant") return choice;
    const existing = m.tool_calls;
    if (Array.isArray(existing) && existing.length > 0) return choice;
    const content = m.content;
    if (typeof content !== "string") return choice;
    const stripped = stripAssistantToolJsonFence(content);
    if (!stripped.startsWith("[") && !stripped.startsWith("{")) return choice;
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripped);
    } catch {
      return choice;
    }
    const rawItems: unknown[] = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object"
        ? [parsed]
        : [];
    if (rawItems.length === 0) return choice;
    const toolCalls: ToolCallShape[] = [];
    for (let i = 0; i < rawItems.length; i++) {
      const item = rawItems[i];
      if (!item || typeof item !== "object") return choice;
      const o = item as Record<string, unknown>;
      const name = o.name;
      if (typeof name !== "string" || !name.trim()) return choice;
      const argsRaw = o.arguments !== undefined ? o.arguments : o.parameters;
      let argStr: string;
      if (typeof argsRaw === "string") {
        argStr = argsRaw.trim() === "" ? "{}" : argsRaw;
      } else if (argsRaw === undefined || argsRaw === null) {
        argStr = "{}";
      } else if (typeof argsRaw === "object") {
        argStr = JSON.stringify(argsRaw);
      } else {
        return choice;
      }
      toolCalls.push({
        id: newToolCallId(choiceIdx * 10 + i),
        type: "function",
        function: { name: name.trim(), arguments: argStr },
      });
    }
    anyChanged = true;
    return {
      ...ch,
      message: {
        ...m,
        content: null,
        tool_calls: toolCalls,
      },
    };
  });
  if (!anyChanged) return data;
  return { ...data, choices: newChoices };
}

async function maybePatchVeniceChatCompletionsResponse(res: Response): Promise<Response> {
  if (!res.ok) return res;
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("json")) return res;
  let text: string;
  try {
    text = await res.clone().text();
  } catch {
    return res;
  }
  if (!text.trim()) return res;
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    const patched = patchChatCompletionsResponseFromVenice(data);
    if (patched === data) return res;
    const headers = new Headers(res.headers);
    return new Response(JSON.stringify(patched), {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  } catch {
    return res;
  }
}

/** Patches JSON chat/completions bodies before send so Venice accepts tool-only assistant messages. */
export async function veniceCompatibleFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  let nextInit = init;
  if (init?.body) {
    const bodyStr = await readRequestBodyAsString(init.body as BodyInit);
    if (bodyStr) {
      try {
        const parsed = JSON.parse(bodyStr) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          patchChatCompletionsBodyForVenice(parsed as Record<string, unknown>);
          nextInit = { ...init, body: JSON.stringify(parsed) };
        }
      } catch {
        // keep original init
      }
    }
  }
  const res = await fetch(input, nextInit);
  return maybePatchVeniceChatCompletionsResponse(res);
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
