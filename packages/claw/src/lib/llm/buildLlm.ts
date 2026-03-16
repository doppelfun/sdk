/**
 * Build LLM: MML generation via AI SDK generateText; build_with_code via @google/genai code execution.
 */
import { generateText } from "ai";
import type { LanguageModel } from "ai";
import type { ClawConfig } from "../config/index.js";
import type { Usage } from "./usage.js";
import { usageFromAiSdk } from "./usage.js";
import { createGeminiClient, runCodeExecution } from "./geminiCodeExec.js";
import { BLOCK_SIZE_M } from "../../util/blockBounds.js";
import type { BlockBounds } from "../../util/blockBounds.js";

export type { BlockBounds };

function formatBoundsStrict(_blockBounds: BlockBounds): string {
  return `COORDINATE SPACE — LOCAL ONLY (always). Never world space.
Every x and z in MML MUST satisfy 0 <= x < 100 and 0 <= z < 100 (half-open). y >= 0.
Valid: x="50" z="50" x="99.5" — INVALID (invisible): x="100" x="150" z="-1"
Server maps this block to world — do not add offsets.`;
}

const BUILD_SYSTEM = `You are an MML (scene markup) generator for a 3D world. You output valid MML only: XML-style tags like <m-group>, <m-cube>, <m-model>, <m-grass>, etc.
- Use catalogId from the provided catalog for <m-model> when available.
- Every entity MUST have a unique id attribute. If the message says INCREMENTAL, do NOT reuse any id listed under "Existing entity ids".
- Position is ALWAYS separate attributes: x="..." y="..." z="...". NEVER use a single position="..." attribute.
- Place all entities at y >= 0. For a 100×100 block, x and z must ALWAYS be in [0, 100) — use 0 through 99.x only.
- Glow: ONLY emission="#RRGGBB" and emission-intensity="0.6" (number). NEVER emissive or emissive-intensity.
- m-attr-anim: ONLY attr start end plus optional duration, loop, easing. Animatable: ry, x, y, z, width, height, depth, emission-intensity, color, emission.
- If the message says FULL: output a complete MML document. If it says INCREMENTAL: output ONLY new tags to append — no full document wrapper.
- No explanation, no markdown code fence — only raw MML.`;

export type BuildMmlResult = { ok: true; mml: string; usage: Usage | null } | { ok: false; error: string };

function extractExistingIds(mml: string): string[] {
  const ids: string[] = [];
  const re = /id\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(mml)) !== null) ids.push(m[1]!);
  return [...new Set(ids)];
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
  return s.replace(/position\s*=\s*["']([^"']+)["']/gi, (_, value: string) => {
    const parts = value.trim().split(/\s+/);
    if (parts.length >= 3) return `x="${parts[0]}" y="${parts[1]}" z="${parts[2]}"`;
    if (parts.length === 2) return `x="${parts[0]}" z="${parts[1]}"`;
    return `x="${parts[0] || "0"}"`;
  });
}

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

export async function buildFull(
  model: LanguageModel,
  instruction: string,
  catalogJson: string,
  blockBounds: BlockBounds
): Promise<BuildMmlResult> {
  const boundsBlock = formatBoundsStrict(blockBounds);
  const userContent = `MODE: FULL — output a complete MML document for the whole scene.

Catalog (id, name, url, category):
${catalogJson}

${boundsBlock}

Instruction: ${instruction}`;

  try {
    const { text, usage } = await generateText({
      model,
      system: BUILD_SYSTEM,
      prompt: userContent,
      temperature: 0.2,
    });
    const mml = extractMml(text);
    const sanitized = normalizeMmlXZToBlockLocal(mml, blockBounds);
    return { ok: true, mml: sanitized, usage: usageFromAiSdk(usage) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "build_full failed",
    };
  }
}

export async function buildIncremental(
  model: LanguageModel,
  instruction: string,
  existingMml: string,
  catalogJson: string,
  blockBounds: BlockBounds,
  positionHint?: string
): Promise<BuildMmlResult> {
  const boundsBlock = formatBoundsStrict(blockBounds);
  const existingIds = extractExistingIds(existingMml);
  let userContent = `MODE: INCREMENTAL — output ONLY the new MML fragment to append. Do not output the existing document.

Existing MML (reference only; do not repeat):
${existingMml || "(empty)"}

Catalog:
${catalogJson}

${boundsBlock}
Existing entity ids (do NOT reuse): ${existingIds.length > 0 ? existingIds.join(", ") : "(none)"}

Instruction: ${instruction}`;
  if (positionHint) userContent += `\nPosition hint: ${positionHint}`;

  try {
    const { text, usage } = await generateText({
      model,
      system: BUILD_SYSTEM,
      prompt: userContent,
      temperature: 0.2,
    });
    const mml = extractMml(text);
    const sanitized = normalizeMmlXZToBlockLocal(mml, blockBounds);
    return { ok: true, mml: sanitized, usage: usageFromAiSdk(usage) };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "build_incremental failed",
    };
  }
}

/** System prompt for build_with_code: MML-only, Python sandbox, block-local coords. */
const BUILD_WITH_CODE_SYSTEM = `You output raw MML only (no markdown, no code fences, no prose). Python sandbox allowed; final message = same MML as plain text.

COORDINATES ARE BLOCK-LOCAL ONLY — NOT WORLD SPACE.
- x and z MUST satisfy 0 <= x < 100 and 0 <= z < 100. Values like 150, 145.5, 106 are INVALID and INVISIBLE.
- Never add block/world offsets. Python: random.uniform(0,99.9); range(0,100); never 100+.

MML SYNTAX (y>=0):
- <m-group id="root-..."> ... </m-group>
- Every <m-cube>, <m-model>, <m-grass> needs unique id="...". Position only x="..." y="..." z="..." (never position="...").
- <m-cube> glow: emission="#hex" emission-intensity="0.6" — NEVER emissive/emissive-intensity.
- m-attr-anim: ONLY attr start end (e.g. attr="ry" start="0" end="360" duration="3000" loop="true"). Animatable: ry, x, y, z, width, height, depth, emission-intensity, color, emission.`;

const BUILD_WITH_CODE_INSTRUCTION_MAX_CHARS = 16_000;

/**
 * Full-scene MML via Gemini code execution (Python sandbox). Requires config.llmProvider = google or google-vertex.
 */
export async function buildFullWithCodeExecution(
  config: ClawConfig,
  modelId: string,
  instruction: string,
  blockBounds: BlockBounds
): Promise<BuildMmlResult> {
  const ai = createGeminiClient(config);
  if (!ai) {
    return {
      ok: false,
      error:
        "build_with_code requires Google Gemini: set LLM_PROVIDER=google (or google-vertex) and GOOGLE_API_KEY in .env. Then use build_full for non-code builds.",
    };
  }
  const boundsBlock =
    blockBounds.xMin === 0 &&
    blockBounds.zMin === 0 &&
    blockBounds.xMax === 100 &&
    blockBounds.zMax === 100
      ? "CRITICAL — x and z are 0..99.9 only (block-local). x=\"150\" or z=\"145\" renders NOTHING. Python: random.uniform(0,99.9); range(0,100); never 100+."
      : formatBoundsStrict(blockBounds);
  const instructionTrimmed =
    instruction.length > BUILD_WITH_CODE_INSTRUCTION_MAX_CHARS
      ? instruction.slice(0, BUILD_WITH_CODE_INSTRUCTION_MAX_CHARS) + "\n… (instruction truncated)"
      : instruction;
  const userContent = `${boundsBlock}\n\nInstruction: ${instructionTrimmed}`;

  const result = await runCodeExecution(ai, modelId, BUILD_WITH_CODE_SYSTEM, userContent, {
    maxOutputTokens: 8192,
    temperature: 0.2,
  });
  if (!result.ok) return result;
  const mml = extractMml(result.content);
  if (!mml.trim() || !mml.includes("<")) {
    return {
      ok: false,
      error: "Code execution did not produce MML (no XML tags). Ask for a simpler build or use build_full.",
    };
  }
  const sanitized = normalizeMmlXZToBlockLocal(mml, blockBounds);
  return { ok: true, mml: sanitized, usage: result.usage };
}
