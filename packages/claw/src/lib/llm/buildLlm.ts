/**
 * Build LLM: MML generation via LlmProvider.complete (OpenRouter or @google/genai).
 */

import type { LlmProvider } from "./provider.js";
import type { Usage } from "./usage.js";
import type { BlockBounds } from "../../util/blockBounds.js";

export type { BlockBounds };

/** Single system prompt; mode (full document vs append fragment) is in the user message. */
const BUILD_SYSTEM = `You are an MML (scene markup) generator for a 3D world. You output valid MML only: XML-style tags like <m-group>, <m-cube>, <m-model>, <m-grass>, etc.
- Use catalogId from the provided catalog for <m-model> when available.
- Every entity MUST have a unique id attribute. If the message says INCREMENTAL, do NOT reuse any id listed under "Existing entity ids".
- Position is ALWAYS separate attributes: x="..." y="..." z="...". NEVER use a single position="..." attribute.
- Place all entities at y >= 0. Keep x and z within the block bounds given in the message.
- If the message says FULL: output a complete MML document (single root or <m-group>). If it says INCREMENTAL: output ONLY new tags to append — no full document wrapper, no repeating existing content.
- No explanation, no markdown code fence — only raw MML.`;

export type BuildMmlMode = "full" | "incremental";

export type BuildMmlResult = { ok: true; mml: string; usage: Usage | null } | { ok: false; error: string };

function extractExistingIds(mml: string): string[] {
  const ids: string[] = [];
  const re = /id\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(mml)) !== null) ids.push(m[1]!);
  return [...new Set(ids)];
}

/**
 * Generate MML. Tool layer passes mode: full → replace document; incremental → append fragment.
 */
export async function buildMml(
  provider: LlmProvider,
  model: string,
  mode: BuildMmlMode,
  instruction: string,
  catalogJson: string,
  blockBounds: BlockBounds,
  options?: { existingMml?: string; positionHint?: string }
): Promise<BuildMmlResult> {
  const boundsLine = `Block bounds (y >= 0; x in [${blockBounds.xMin}, ${blockBounds.xMax}), z in [${blockBounds.zMin}, ${blockBounds.zMax})).`;

  let userContent: string;
  if (mode === "full") {
    userContent = `MODE: FULL — output a complete MML document for the whole scene.

Catalog (id, name, url, category):
${catalogJson}

${boundsLine}

Instruction: ${instruction}`;
  } else {
    const existingMml = options?.existingMml ?? "";
    const existingIds = extractExistingIds(existingMml);
    userContent = `MODE: INCREMENTAL — output ONLY the new MML fragment to append. Do not output the existing document.

Existing MML (reference only; do not repeat):
${existingMml || "(empty)"}

Catalog:
${catalogJson}

${boundsLine}
Existing entity ids (do NOT reuse): ${existingIds.length > 0 ? existingIds.join(", ") : "(none)"}

Instruction: ${instruction}`;
    if (options?.positionHint) userContent += `\nPosition hint: ${options.positionHint}`;
  }

  const result = await provider.complete({
    model,
    system: BUILD_SYSTEM,
    user: userContent,
    maxOutputTokens: 8192,
    temperature: 0.2,
  });
  if (!result.ok) return result;
  const mml = extractMml(result.content);
  return { ok: true, mml, usage: result.usage };
}

/** Full-scene replace. Same as buildMml(..., "full", ...). */
export async function buildFull(
  provider: LlmProvider,
  model: string,
  instruction: string,
  catalogJson: string,
  blockBounds: BlockBounds
): Promise<BuildMmlResult> {
  return buildMml(provider, model, "full", instruction, catalogJson, blockBounds);
}

/** Fragment to append. Same as buildMml(..., "incremental", ...); returned mml is the fragment. */
export async function buildIncremental(
  provider: LlmProvider,
  model: string,
  instruction: string,
  existingMml: string,
  catalogJson: string,
  blockBounds: BlockBounds,
  positionHint?: string
): Promise<BuildMmlResult> {
  return buildMml(provider, model, "incremental", instruction, catalogJson, blockBounds, {
    existingMml,
    positionHint,
  });
}

function extractMml(content: string): string {
  let s = content.trim();
  const fence = "```";
  if (s.startsWith(fence)) {
    const rest = s.slice(fence.length);
    const lang = rest.split("\n")[0]!.trim();
    const end = rest.indexOf("\n" + fence, lang.length);
    s =
      end >= 0
        ? rest.slice(rest.indexOf("\n") + 1, end).trim()
        : rest.slice(rest.indexOf("\n") + 1).trim();
  }
  return rewritePositionToXyz(s);
}

function rewritePositionToXyz(mml: string): string {
  return mml.replace(/position\s*=\s*["']([^"']+)["']/gi, (_, value: string) => {
    const parts = value.trim().split(/\s+/);
    if (parts.length >= 3) return `x="${parts[0]}" y="${parts[1]}" z="${parts[2]}"`;
    if (parts.length === 2) return `x="${parts[0]}" z="${parts[1]}"`;
    return `x="${parts[0] || "0"}"`;
  });
}
