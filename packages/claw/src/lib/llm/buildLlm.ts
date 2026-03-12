/**
 * Build LLM: MML generation via LlmProvider.complete (OpenRouter or @google/genai).
 */

import type { LlmProvider } from "./provider.js";
import type { Usage } from "./usage.js";
import type { BlockBounds } from "../../util/blockBounds.js";

export type { BlockBounds };

/**
 * Strict bounds text for every build user message. Half-open intervals [xMin,xMax) so x=xMax is OUT.
 * Models often emit x=100 or x=106 when they mean "edge" — that is invisible outside the block.
 */
function formatBoundsStrict(blockBounds: BlockBounds): string {
  const { xMin, xMax, zMin, zMax } = blockBounds;
  const xSpan = xMax - xMin;
  const zSpan = zMax - zMin;
  const same100 = xSpan === 100 && zSpan === 100;
  const hard =
    same100
      ? `HARD RULE — 100×100 m block only. Every m-cube/m-model must have x in [${xMin}, ${xMax}) and z in [${zMin}, ${zMax}) — use x from ${xMin} up to ${xMax - 1} (or ${xMax} - epsilon), never x >= ${xMax}. Same for z. Example valid: x="50" z="50". INVALID: x="${xMax}" or x="${xMax + 6}" (outside; player sees nothing). If using Python loops, clamp or use range(${xMin}, ${xMax}) for x and range(${zMin}, ${zMax}) for z.`
      : `HARD RULE — stay inside this block only. Every entity x must satisfy ${xMin} <= x < ${xMax}; every z must satisfy ${zMin} <= z < ${zMax}. Never place geometry at or beyond xMax/zMax — it will not appear in the playable area.`;
  return `Block bounds (y >= 0; x in [${xMin}, ${xMax}), z in [${zMin}, ${zMax})).\n${hard}`;
}

/** Single system prompt; mode (full document vs append fragment) is in the user message. */
const BUILD_SYSTEM = `You are an MML (scene markup) generator for a 3D world. You output valid MML only: XML-style tags like <m-group>, <m-cube>, <m-model>, <m-grass>, etc.
- Use catalogId from the provided catalog for <m-model> when available.
- Every entity MUST have a unique id attribute. If the message says INCREMENTAL, do NOT reuse any id listed under "Existing entity ids".
- Position is ALWAYS separate attributes: x="..." y="..." z="...". NEVER use a single position="..." attribute.
- Place all entities at y >= 0. x and z MUST lie strictly inside the block bounds in the user message — half-open [min,max): values at or above max are outside the block and invisible. Prefer coordinates in the middle of the range (e.g. 10–90 when the block is 100 wide) so nothing clips at edges.
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
  const boundsBlock = formatBoundsStrict(blockBounds);

  let userContent: string;
  if (mode === "full") {
    userContent = `MODE: FULL — output a complete MML document for the whole scene.

Catalog (id, name, url, category):
${catalogJson}

${boundsBlock}

Instruction: ${instruction}`;
  } else {
    const existingMml = options?.existingMml ?? "";
    const existingIds = extractExistingIds(existingMml);
    userContent = `MODE: INCREMENTAL — output ONLY the new MML fragment to append. Do not output the existing document.

Existing MML (reference only; do not repeat):
${existingMml || "(empty)"}

Catalog:
${catalogJson}

${boundsBlock}
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

/**
 * System prompt when code execution is enabled — same MML rules as BUILD_SYSTEM, plus Python sandbox.
 * Keep in sync with BUILD_SYSTEM for tag/attribute rules so code path produces valid scene markup.
 */
const BUILD_WITH_CODE_SYSTEM = `You are an MML (scene markup) generator for a 3D world. You may use Python in the code execution sandbox to compute layouts, loops, positions, or to build/print MML strings (e.g. loops that emit many <m-cube> lines).

How to build with MML (must match what build_full uses):
- Output valid MML only: XML-style tags such as <m-group>, <m-cube>, <m-model>, <m-grass>, etc. One document root (e.g. wrap everything in <m-group>).
- Use catalogId from the provided catalog for <m-model> when available: <m-model catalogId="..." id="..." x="..." y="..." z="..." />.
- Every entity MUST have a unique id attribute. If you generate many entities in Python, ensure ids are unique (e.g. prefix + index).
- Position is ALWAYS separate attributes: x="..." y="..." z="...". NEVER use a single position="..." attribute.
- Place all entities at y >= 0. x and z MUST be strictly inside the bounds in the user message (half-open [min,max)); never use x >= xMax or z >= zMax — geometry outside is invisible. Python loops must use ranges/clamps within those limits.
- MODE is always FULL here: output a complete MML document for the whole scene (single root or <m-group>). Do not output incremental fragments only.

Python sandbox:
- You may run Python to compute coordinates, loops, or to assemble a full MML string (print it for your own check).
- Your final assistant message must still be ONLY raw MML — no markdown, no code fence, no explanation — so it can be posted to the world. If code printed MML, repeat that same MML as the final text response.`;

/**
 * Full-scene MML via Gemini code execution (Python sandbox). Falls back error if provider has no sandbox.
 * Same post-processing as build_full (extractMml).
 */
export async function buildFullWithCodeExecution(
  provider: LlmProvider,
  model: string,
  instruction: string,
  catalogJson: string,
  blockBounds: BlockBounds
): Promise<BuildMmlResult> {
  const run = provider.completeWithCodeExecution;
  if (!run) {
    return {
      ok: false,
      error:
        "build_with_code requires Google Gemini (LLM_PROVIDER=google or google-vertex).",
    };
  }
  const boundsBlock = formatBoundsStrict(blockBounds);
  const userContent = `MODE: FULL with code execution — use Python if helpful for repetition/math, then output complete MML only (same tag and attribute rules as build_full; see system).

Catalog (id, name, url, category) — use these ids as catalogId on <m-model> where appropriate:
${catalogJson}

${boundsBlock}

Instruction: ${instruction}`;
  // Must call as method on provider — extracting run() loses `this` and breaks this.ai in GoogleGenAiProviderBase.
  const result = await run.call(provider, {
    model,
    system: BUILD_WITH_CODE_SYSTEM,
    user: userContent,
    maxOutputTokens: 8192,
    temperature: 0.2,
  });
  if (!result.ok) return result;
  const mml = extractMml(result.content);
  if (!mml.trim() || !mml.includes("<")) {
    return {
      ok: false,
      error:
        "Code execution did not produce MML (no XML tags). Ask for a simpler build or use build_full.",
    };
  }
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
