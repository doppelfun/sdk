/**
 * Build LLM: full-scene and incremental MML generation via OpenRouter.
 * Uses simpleCompletion (no tools); extracts raw MML from response (strips markdown fences if present).
 */

import { simpleCompletion, type Usage } from "./openrouter.js";

const BUILD_FULL_SYSTEM = `You are an MML (scene markup) generator for a 3D world. You output valid MML only: XML-style tags like <m-group>, <m-cube>, <m-model>, <m-grass>, etc.
- Use catalogId from the provided catalog for <m-model> when available.
- Output a complete, valid MML document (single root or wrapped in <m-group>). No explanation, no markdown code fence — only raw MML.`;

const BUILD_INCREMENTAL_SYSTEM = `You are an MML (scene markup) generator for a 3D world. You output ONLY the new MML fragment to append — not the full document.
- The user will provide the existing MML and an instruction (e.g. "add a bench at 2,0,4" or "add a fountain here").
- Output only the new tags to add: e.g. one or more <m-cube>, <m-model>, or a small <m-group>. No explanation, no markdown, no wrapping in a full document. Use catalogId from the catalog for models when relevant.`;

export type BuildFullResult = { ok: true; mml: string; usage: Usage | null } | { ok: false; error: string };
export type BuildIncrementalResult = { ok: true; mmlFragment: string; usage: Usage | null } | { ok: false; error: string };

/**
 * Generate full MML for a new or replacement scene. Uses catalog for model catalogIds.
 */
export async function buildFull(
  apiKey: string,
  model: string,
  instruction: string,
  catalogJson: string
): Promise<BuildFullResult> {
  const userContent = `Catalog (id, name, glbUrl, category):\n${catalogJson}\n\nInstruction: ${instruction}`;
  const result = await simpleCompletion(apiKey, model, BUILD_FULL_SYSTEM, userContent);
  if (!result.ok) return result;
  const mml = extractMml(result.content);
  return { ok: true, mml, usage: result.usage };
}

/**
 * Generate only the MML fragment to append. Takes existing MML + instruction + optional position hint.
 */
export async function buildIncremental(
  apiKey: string,
  model: string,
  instruction: string,
  existingMml: string,
  catalogJson: string,
  positionHint?: string
): Promise<BuildIncrementalResult> {
  let userContent = `Existing MML (current document):\n${existingMml || "(empty)"}\n\nCatalog:\n${catalogJson}\n\nInstruction: ${instruction}`;
  if (positionHint) userContent += `\nPosition hint: ${positionHint}`;
  const result = await simpleCompletion(apiKey, model, BUILD_INCREMENTAL_SYSTEM, userContent);
  if (!result.ok) return result;
  const mmlFragment = extractMml(result.content);
  return { ok: true, mmlFragment, usage: result.usage };
}

/** Strip markdown code fence (```) if present and trim. Returns raw MML. */
function extractMml(content: string): string {
  let s = content.trim();
  const fence = "```";
  if (s.startsWith(fence)) {
    const rest = s.slice(fence.length);
    const lang = rest.split("\n")[0].trim();
    const end = rest.indexOf("\n" + fence, lang.length);
    s = end >= 0 ? rest.slice(rest.indexOf("\n") + 1, end).trim() : rest.slice(rest.indexOf("\n") + 1).trim();
  }
  return s;
}
