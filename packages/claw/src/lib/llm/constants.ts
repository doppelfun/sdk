/**
 * Shared LLM defaults — no JSDoc tags that confuse parsers (avoid at-sign in block comments).
 * Gemini model id when LLM_PROVIDER is google or google-vertex and env models unset.
 * See https://ai.google.dev/gemini-api/docs/models
 */
export const DEFAULT_GOOGLE_MODEL = "gemini-2.5-flash";
