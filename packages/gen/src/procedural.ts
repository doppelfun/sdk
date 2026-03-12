/**
 * Procedural dispatch — single place OSS contributors register new kinds.
 *
 * Claw only imports: runProceduralMml(kind, raw), listProceduralKinds()
 * See CONTRIBUTING.md — register in PROCEDURAL_REGISTRY only.
 */

import { generatePyramidMml } from "./pyramid/service.js";
import { clampPyramidConfig } from "./pyramid/config.js";
import { generateCityMml } from "./city/service.js";
import { clampCityConfig } from "./city/config.js";

export type ProceduralHandler = (raw: Record<string, unknown>) => string;
export type ProceduralEntry = { kind: string; run: ProceduralHandler };

/** Params for generators live under raw.params only (kind/documentMode are Claw-owned). */
function getParams(raw: Record<string, unknown>): Record<string, unknown> {
  const p = raw.params;
  if (p && typeof p === "object" && !Array.isArray(p)) return p as Record<string, unknown>;
  return {};
}

function pyramidHandler(raw: Record<string, unknown>): string {
  const p = getParams(raw);
  const cfg = clampPyramidConfig({
    baseWidth: typeof p.baseWidth === "number" ? p.baseWidth : undefined,
    layers: typeof p.layers === "number" ? p.layers : undefined,
    blockSize: typeof p.blockSize === "number" ? p.blockSize : undefined,
    doorWidthBlocks: typeof p.doorWidthBlocks === "number" ? p.doorWidthBlocks : undefined,
    seed: typeof p.seed === "number" ? p.seed : undefined,
    cx: typeof p.cx === "number" ? p.cx : undefined,
    cz: typeof p.cz === "number" ? p.cz : undefined,
  });
  return generatePyramidMml(cfg);
}

function cityHandler(raw: Record<string, unknown>): string {
  const c = getParams(raw);
  const noPyramid =
    c.pyramid === false ||
    c.noPyramid === true ||
    c.pyramid === "none" ||
    c.pyramid === "off";
  const cfg = clampCityConfig({
    gridRows: typeof c.rows === "number" ? c.rows : typeof c.gridRows === "number" ? c.gridRows : undefined,
    gridCols: typeof c.cols === "number" ? c.cols : typeof c.gridCols === "number" ? c.gridCols : undefined,
    blockSize: typeof c.blockSize === "number" ? c.blockSize : undefined,
    streetWidth: typeof c.streetWidth === "number" ? c.streetWidth : undefined,
    buildingSetback:
      typeof c.setback === "number" ? c.setback : typeof c.buildingSetback === "number" ? c.buildingSetback : undefined,
    seed: typeof c.seed === "number" ? c.seed : undefined,
    pyramidRow: typeof c.pyramidRow === "number" ? c.pyramidRow : undefined,
    pyramidCol: typeof c.pyramidCol === "number" ? c.pyramidCol : undefined,
    noPyramid,
  });
  return generateCityMml(cfg);
}

const PROCEDURAL_REGISTRY: ProceduralEntry[] = [
  { kind: "pyramid", run: pyramidHandler },
  { kind: "city", run: cityHandler },
];

function buildHandlerMap(): Record<string, ProceduralHandler> {
  const map: Record<string, ProceduralHandler> = {};
  for (const { kind, run } of PROCEDURAL_REGISTRY) {
    const k = kind.trim().toLowerCase();
    if (map[k]) throw new Error(`Duplicate procedural kind "${k}" in PROCEDURAL_REGISTRY`);
    map[k] = run;
  }
  return map;
}

const HANDLERS = buildHandlerMap();

/** Run registered procedural; raw must include kind at top level, params under raw.params. */
export function runProceduralMml(kind: string, raw: Record<string, unknown>): string {
  const k = kind.trim().toLowerCase();
  const handler = HANDLERS[k];
  if (!handler) {
    const known = Object.keys(HANDLERS).join(", ");
    throw new Error(`Unknown procedural kind "${kind}". Known kinds: ${known}`);
  }
  return handler(raw);
}

export function listProceduralKinds(): string[] {
  return Object.keys(HANDLERS);
}
