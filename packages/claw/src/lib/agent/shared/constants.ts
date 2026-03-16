/** Error message when no chat model can be resolved (missing API key or provider). */
export const NO_CHAT_MODEL_ERROR =
  "No chat model: set OPENROUTER_API_KEY and LLM_PROVIDER=openrouter (or configure Google).";

/** Minimum ms to show "thinking" after an LLM call (avoids flicker). */
export const MIN_THINKING_MS = 700;
