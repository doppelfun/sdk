/**
 * OpenRouter API client: chat completions with optional tool use.
 * @see https://openrouter.ai/docs/api-reference/chat-completion
 */

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

/** One message in the conversation (system, user, or assistant). */
export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/** OpenAI-compatible function tool schema (name, description, parameters). */
export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties?: Record<string, { type: string; description?: string }>;
      required?: string[];
    };
  };
};

/** Token usage returned by OpenRouter. */
export type Usage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

/** One tool call in the assistant message. */
export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

/** Assistant message: optional content and/or tool_calls. */
export type ChatCompletionMessage = {
  role: "assistant";
  content: string | null;
  tool_calls?: ToolCall[];
};

/** Options for chatCompletion. */
export type ChatCompletionOptions = {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  tool_choice?: "auto" | "required" | { type: "function"; function: { name: string } };
  max_tokens?: number;
  temperature?: number;
};

export type ChatCompletionResult =
  | { ok: true; message: ChatCompletionMessage; usage: Usage | null }
  | { ok: false; error: string; status?: number };

/**
 * Call OpenRouter chat completions. Sends messages and optional tools; returns assistant message (content and/or tool_calls).
 */
export async function chatCompletion(
  apiKey: string,
  options: ChatCompletionOptions
): Promise<ChatCompletionResult> {
  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    max_tokens: options.max_tokens ?? 4096,
    temperature: options.temperature ?? 0.3,
  };
  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
    body.tool_choice = options.tool_choice ?? "auto";
  }
  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://github.com/doppel-sdk",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, error: text || `HTTP ${res.status}`, status: res.status };
  }
  let data: { choices?: Array<{ message?: ChatCompletionMessage }>; usage?: Usage };
  try {
    data = JSON.parse(text) as { choices?: Array<{ message?: ChatCompletionMessage }>; usage?: Usage };
  } catch {
    return { ok: false, error: "Invalid JSON from OpenRouter" };
  }
  const message = data.choices?.[0]?.message;
  if (!message) {
    return { ok: false, error: "OpenRouter response missing choices[0].message" };
  }
  const usage = data.usage && typeof data.usage.total_tokens === "number" ? data.usage : null;
  return { ok: true, message, usage };
}

/**
 * Simple completion (no tools). Used by Build LLM: system + user message, returns assistant content.
 */
export async function simpleCompletion(
  apiKey: string,
  model: string,
  systemPrompt: string,
  userContent: string
): Promise<{ ok: true; content: string; usage: Usage | null } | { ok: false; error: string }> {
  const result = await chatCompletion(apiKey, {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    max_tokens: 8192,
    temperature: 0.2,
  });
  if (!result.ok) return result;
  const content = result.message.content ?? "";
  return { ok: true, content, usage: result.usage };
}
