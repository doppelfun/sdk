/**
 * Shared LLM defaults — no JSDoc tags that confuse parsers (avoid at-sign in block comments).
 * Gemini 3 model id when LLM_PROVIDER is google or google-vertex and env models unset.
 * @see https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite-preview
 * @see https://ai.google.dev/gemini-api/docs/models
 */
export const DEFAULT_GOOGLE_MODEL = "gemini-3.1-flash-lite-preview";
