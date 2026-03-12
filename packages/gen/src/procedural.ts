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
import { normalizeBuildingsParam } from "./city/layout/catalog-bridge.js";
import { generateGrassMml } from "./grass/service.js";
import { clampGrassConfig } from "./grass/config.js";
import { generateTreesMml } from "./trees/service.js";
import { clampTreesConfig } from "./trees/config.js";

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
  const cornerColors =
    Array.isArray(p.cornerColors) ? p.cornerColors : Array.isArray(p.corner_colors) ? p.corner_colors : undefined;
  const cfg = clampPyramidConfig({
    baseWidth: typeof p.baseWidth === "number" ? p.baseWidth : undefined,
    layers: typeof p.layers === "number" ? p.layers : undefined,
    blockSize: typeof p.blockSize === "number" ? p.blockSize : undefined,
    doorWidthBlocks: typeof p.doorWidthBlocks === "number" ? p.doorWidthBlocks : undefined,
    seed: typeof p.seed === "number" ? p.seed : undefined,
    cx: typeof p.cx === "number" ? p.cx : undefined,
    cz: typeof p.cz === "number" ? p.cz : undefined,
    cornerColors,
    cornerEmissionIntensity:
      typeof p.cornerEmissionIntensity === "number"
        ? p.cornerEmissionIntensity
        : typeof p.corner_emission_intensity === "number"
          ? p.corner_emission_intensity
          : undefined,
  });
  return generatePyramidMml(cfg);
}

function cityHandler(raw: Record<string, unknown>): string {
  const c = getParams(raw);
  const buildingsFromParams =
    normalizeBuildingsParam(c.buildings) ?? normalizeBuildingsParam((raw as { buildings?: unknown }).buildings);
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
  return generateCityMml(cfg, buildingsFromParams ? { buildings: buildingsFromParams } : undefined);
}

function grassHandler(raw: Record<string, unknown>): string {
  const p = getParams(raw);
  const cfg = clampGrassConfig({
    patches: typeof p.patches === "number" ? p.patches : undefined,
    count: typeof p.count === "number" ? p.count : undefined,
    spreadMin: typeof p.spreadMin === "number" ? p.spreadMin : undefined,
    spreadMax: typeof p.spreadMax === "number" ? p.spreadMax : undefined,
    height: typeof p.height === "number" ? p.height : undefined,
    y: typeof p.y === "number" ? p.y : undefined,
    seed: typeof p.seed === "number" ? p.seed : undefined,
    margin: typeof p.margin === "number" ? p.margin : undefined,
    emissionIntensity:
      typeof p.emissionIntensity === "number"
        ? p.emissionIntensity
        : typeof p.emission_intensity === "number"
          ? p.emission_intensity
          : undefined,
  });
  return generateGrassMml(cfg);
}

function treesHandler(raw: Record<string, unknown>): string {
  const p = getParams(raw);
  const catalogIds = Array.isArray(p.catalogIds)
    ? p.catalogIds
    : Array.isArray(p.catalog_ids)
      ? p.catalog_ids
      : undefined;
  const cfg = clampTreesConfig({
    count: typeof p.count === "number" ? p.count : undefined,
    catalogId: typeof p.catalogId === "string" ? p.catalogId : undefined,
    catalogIds: catalogIds as string[] | undefined,
    seed: typeof p.seed === "number" ? p.seed : undefined,
    margin: typeof p.margin === "number" ? p.margin : undefined,
    collide: typeof p.collide === "boolean" ? p.collide : undefined,
  });
  return generateTreesMml(cfg);
}

const PROCEDURAL_REGISTRY: ProceduralEntry[] = [
  { kind: "pyramid", run: pyramidHandler },
  { kind: "city", run: cityHandler },
  { kind: "grass", run: grassHandler },
  { kind: "trees", run: treesHandler },
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
