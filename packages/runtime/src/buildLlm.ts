/**
 * Build LLM: full-scene and incremental MML generation via OpenRouter.
 * Uses simpleCompletion (no tools); extracts raw MML from response (strips markdown fences if present).
 */

import { simpleCompletion, type Usage } from "./openrouter.js";

export type RegionBounds = { xMin: number; xMax: number; zMin: number; zMax: number };

const BUILD_FULL_SYSTEM = `You are an MML (scene markup) generator for a 3D world. You output valid MML only: XML-style tags like <m-group>, <m-cube>, <m-model>, <m-grass>, etc.
- Use catalogId from the provided catalog for <m-model> when available.
- Every entity (m-cube, m-model, m-group, m-grass, etc.) MUST have a unique id attribute (e.g. id="bench-1", id="tree-2"). Use a consistent prefix and counter or descriptive unique names.
- Position is ALWAYS specified as separate attributes: x="..." y="..." z="..." (e.g. x="2" y="0" z="5"). NEVER use a single "position" attribute (e.g. position="-2.5 2.5 -2.5" is invalid).
- Place all entities at y >= 0. Keep x and z within the region bounds given in the instruction (xMin <= x < xMax, zMin <= z < zMax).
- Output a complete, valid MML document (single root or wrapped in <m-group>). No explanation, no markdown code fence — only raw MML.`;

const BUILD_INCREMENTAL_SYSTEM = `You are an MML (scene markup) generator for a 3D world. You output ONLY the new MML fragment to append — not the full document.
- The user will provide the existing MML and an instruction (e.g. "add a bench at 2,0,4" or "add a fountain here").
- Every new entity (m-cube, m-model, m-group, m-grass, etc.) MUST have a unique id attribute. Do NOT reuse any of the existing entity ids listed in the instruction — pick new unique ids (e.g. id="bench-3" if bench-1 and bench-2 exist).
- Position is ALWAYS specified as separate attributes: x="..." y="..." z="..." (e.g. x="2" y="0" z="5"). NEVER use a single "position" attribute (e.g. position="-2.5 2.5 -2.5" is invalid).
- Place all entities at y >= 0. Keep x and z within the region bounds given in the instruction (xMin <= x < xMax, zMin <= z < zMax).
- Output only the new tags to add: e.g. one or more <m-cube>, <m-model>, or a small <m-group>. No explanation, no markdown, no wrapping in a full document. Use catalogId from the catalog for models when relevant.`;

export type BuildFullResult = { ok: true; mml: string; usage: Usage | null } | { ok: false; error: string };
export type BuildIncrementalResult = { ok: true; mmlFragment: string; usage: Usage | null } | { ok: false; error: string };

/** Extract id attribute values from MML (id="...") for deduplication in incremental builds. */
function extractExistingIds(mml: string): string[] {
  const ids: string[] = [];
  const re = /id\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(mml)) !== null) ids.push(m[1]);
  return [...new Set(ids)];
}

/**
 * Generate full MML for a new or replacement scene. Uses catalog for model catalogIds.
 * regionBounds: place entities with y >= 0 and x,z within [xMin,xMax), [zMin,zMax).
 */
export async function buildFull(
  apiKey: string,
  model: string,
  instruction: string,
  catalogJson: string,
  regionBounds: RegionBounds
): Promise<BuildFullResult> {
  const userContent = `Catalog (id, name, glbUrl, category):\n${catalogJson}

Region bounds (place all entities inside; y must be >= 0): x in [${regionBounds.xMin}, ${regionBounds.xMax}), z in [${regionBounds.zMin}, ${regionBounds.zMax}].

Instruction: ${instruction}`;
  const result = await simpleCompletion(apiKey, model, BUILD_FULL_SYSTEM, userContent);
  if (!result.ok) return result;
  const mml = extractMml(result.content);
  return { ok: true, mml, usage: result.usage };
}

/**
 * Generate only the MML fragment to append. Takes existing MML + instruction + optional position hint.
 * regionBounds: place new entities with y >= 0 and x,z within bounds. existingIds: do not reuse these ids.
 */
export async function buildIncremental(
  apiKey: string,
  model: string,
  instruction: string,
  existingMml: string,
  catalogJson: string,
  regionBounds: RegionBounds,
  positionHint?: string
): Promise<BuildIncrementalResult> {
  const existingIds = extractExistingIds(existingMml);
  let userContent = `Existing MML (current document):\n${existingMml || "(empty)"}\n\nCatalog:\n${catalogJson}

Region bounds (place all new entities inside; y must be >= 0): x in [${regionBounds.xMin}, ${regionBounds.xMax}), z in [${regionBounds.zMin}, ${regionBounds.zMax}].
Existing entity ids (do NOT reuse): ${existingIds.length > 0 ? existingIds.join(", ") : "(none)"}

Instruction: ${instruction}`;
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
  return rewritePositionToXyz(s);
}

/** Rewrite position="x y z" to x="x" y="y" z="z" so engine receives valid MML. */
function rewritePositionToXyz(mml: string): string {
  return mml.replace(
    /position\s*=\s*["']([^"']+)["']/gi,
    (_, value) => {
      const parts = value.trim().split(/\s+/);
      if (parts.length >= 3) {
        return `x="${parts[0]}" y="${parts[1]}" z="${parts[2]}"`;
      }
      if (parts.length === 2) {
        return `x="${parts[0]}" z="${parts[1]}"`;
      }
      return `x="${parts[0] || "0"}"`;
    }
  );
}
