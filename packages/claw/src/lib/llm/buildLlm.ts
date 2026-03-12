/**
 * Build LLM: MML generation via LlmProvider.complete (OpenRouter or @google/genai).
 */

import type { LlmProvider } from "./provider.js";
import type { Usage } from "./usage.js";
import type { BlockBounds } from "../../util/blockBounds.js";
import { BLOCK_SIZE_M } from "../../util/blockBounds.js";

export type { BlockBounds };

/**
 * MML document content is **always** local block space: 0 <= x < 100, 0 <= z < 100.
 * Server applies block origin when applying to world — authors must never use world x/z in MML.
 * We never pass getBlockBounds() world ranges here; doing so made the model emit x=150 for slot 1_0
 * because the prompt said x in [100,200), while the engine still parses local 0–100 only.
 */
function formatBoundsStrict(_blockBounds: BlockBounds): string {
  return `COORDINATE SPACE — LOCAL ONLY (always). Never world space.
Every x and z in MML MUST satisfy 0 <= x < 100 and 0 <= z < 100 (half-open). y >= 0.
Valid: x="50" z="50" x="99.5" — INVALID (invisible): x="100" x="150" z="-1"
Python: only range(0, 100) or random.uniform(0, 99.9) for x/z; before any print(), x = max(0, min(99.9, x)).
Server maps this block to world — do not add offsets.`;
}

/** Single system prompt; mode (full document vs append fragment) is in the user message. */
const BUILD_SYSTEM = `You are an MML (scene markup) generator for a 3D world. You output valid MML only: XML-style tags like <m-group>, <m-cube>, <m-model>, <m-grass>, etc.
- Use catalogId from the provided catalog for <m-model> when available.
- Every entity MUST have a unique id attribute. If the message says INCREMENTAL, do NOT reuse any id listed under "Existing entity ids".
- Position is ALWAYS separate attributes: x="..." y="..." z="...". NEVER use a single position="..." attribute.
- Place all entities at y >= 0. For a 100×100 block, x and z must ALWAYS be in [0, 100) — use 0 through 99.x only; x="100" or z="100" is wrong and invisible. Never emit world-space offsets (e.g. 106); the scene is already block-local.
- Glow: ONLY emission="#RRGGBB" and emission-intensity="0.6" (number). NEVER emissive or emissive-intensity — not parsed, no glow.
- m-attr-anim (child of m-cube/m-group): ONLY attr="..." start="..." end="..." plus optional duration, loop, easing, ping-pong, start-time, pause-time, ping-pong-delay. NEVER attribute/from/to/direction/delay — anim will be ignored. Animatable: ry, x, y, z, width, height, depth, emission-intensity, color, emission — not scale vectors.
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
  let mml = extractMml(result.content);
  mml = normalizeMmlXZToBlockLocal(mml, blockBounds);
  return { ok: true, mml, usage: result.usage };
}

/**
 * Hardcoded MML syntax only — no catalog, no skills. build_with_code uses this as the sole system
 * instruction so Gemini code-exec input stays minimal.
 */
const BUILD_WITH_CODE_SYSTEM = `You output raw MML only (no markdown, no code fences, no prose). Python sandbox allowed; final message = same MML as plain text.

COORDINATES ARE BLOCK-LOCAL ONLY — NOT WORLD SPACE.
- x and z MUST satisfy 0 <= x < 100 and 0 <= z < 100. Values like 150, 145.5, 106 are INVALID and INVISIBLE.
- Never add block/world offsets. If you use random.uniform or similar, use random.uniform(0, 99.9) for x and z — NOT 100–200.
- Python example: x = random.random() * 99.9  # not * 200 + 100
- Python loop: for xi in range(0, 100): ... for zi in range(0, 100): ...

MML SYNTAX (y>=0):
- <m-group id="root-..."> ... </m-group>
- Every <m-cube>, <m-model>, <m-grass> needs unique id="...". Position only x="..." y="..." z="..." (never position="...").
- <m-cube> glow: emission="#hex" emission-intensity="0.6" — NEVER emissive/emissive-intensity (ignored).
- <m-attr-anim> MUST use attr start end (e.g. attr="ry" start="0" end="360" duration="3000" loop="true"). NEVER attribute/from/to/direction/delay — anim dropped. Optional: easing, ping-pong, start-time, pause-time, ping-pong-delay.
- Animatable attrs: ry, x, y, z, width, height, depth, emission-intensity; color/emission as hex lerp only — no scale="0.5 0.5 0.5".
- <m-cube id="..." x="0-99.9" y="..." z="0-99.9" width="1" height="1" depth="1" /> — color, collide, rx/ry/rz.
- <m-model>, <m-grass> same x/z and emission rules.`;

/**
 * Full-scene MML via Gemini code execution. No catalog or extra context — instruction + bounds only.
 */
const BUILD_WITH_CODE_INSTRUCTION_MAX_CHARS = 16_000;

export async function buildFullWithCodeExecution(
  provider: LlmProvider,
  model: string,
  instruction: string,
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
  // Code-exec requests count toward same 1M input cap; use short bounds blurb (full rules in system).
  const boundsBlock =
    blockBounds.xMin === 0 &&
    blockBounds.zMin === 0 &&
    blockBounds.xMax === 100 &&
    blockBounds.zMax === 100
      ? "CRITICAL — x and z are 0..99.9 only (block-local). x=\"150\" or z=\"145\" renders NOTHING. Python: random.uniform(0,99.9); range(0,100); never 100+."
      : formatBoundsStrict(blockBounds);
  const instructionTrimmed =
    instruction.length > BUILD_WITH_CODE_INSTRUCTION_MAX_CHARS
      ? instruction.slice(0, BUILD_WITH_CODE_INSTRUCTION_MAX_CHARS) +
        "\n… (instruction truncated; keep build smaller or use build_full for huge specs)"
      : instruction;
  const userContent = `${boundsBlock}

Instruction: ${instructionTrimmed}`;
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
  // Model often emits world-space x/z (e.g. 150); engine expects block-local [xMin,xMax) etc. Normalize before persist.
  const sanitized = normalizeMmlXZToBlockLocal(mml, blockBounds);
  return { ok: true, mml: sanitized, usage: result.usage };
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

/**
 * Engine parses MML as **local block only**: 0 <= x < BLOCK_SIZE_M, 0 <= z < BLOCK_SIZE_M.
 * Server then applies BLOCK_ORIGIN_X/Z — authors must never add world offsets in MML.
 * Models often emit 150+ (thinking world space). getBlockBounds(slot) is **world** extents
 * (e.g. 1_0 → 100–200); using it for normalize left x=150 unchanged yet still invalid local
 * → entitiesInLocalBounds drops them. Always fold into [0, 100) so persisted MML matches engine.
 */
function normalizeMmlXZToBlockLocal(mml: string, _blockBounds: BlockBounds): string {
  const lo = 0;
  const span = BLOCK_SIZE_M;
  const norm = (v: number): number => {
    if (v >= lo && v < span) return v;
    let t = v - lo;
    t = ((t % span) + span) % span;
    return lo + t;
  };
  const fmt = (v: number): string =>
    Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
  let out = mml.replace(/\bx\s*=\s*["']([^"']+)["']/gi, (_match, val: string) => {
    const v = parseFloat(val);
    if (!Number.isFinite(v)) return `x="${val}"`;
    return `x="${fmt(norm(v))}"`;
  });
  out = out.replace(/\bz\s*=\s*["']([^"']+)["']/gi, (_match, val: string) => {
    const v = parseFloat(val);
    if (!Number.isFinite(v)) return `z="${val}"`;
    return `z="${fmt(norm(v))}"`;
  });
  return out;
}

function rewritePositionToXyz(mml: string): string {
  return mml.replace(/position\s*=\s*["']([^"']+)["']/gi, (_, value: string) => {
    const parts = value.trim().split(/\s+/);
    if (parts.length >= 3) return `x="${parts[0]}" y="${parts[1]}" z="${parts[2]}"`;
    if (parts.length === 2) return `x="${parts[0]}" z="${parts[1]}"`;
    return `x="${parts[0] || "0"}"`;
  });
}
