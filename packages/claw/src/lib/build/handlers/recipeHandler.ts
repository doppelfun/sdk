/**
 * Build handler: run_recipe.
 * Runs a recipe (city, pyramid, grass, trees) via @doppelfun/recipes. No LLM.
 */
import type { DoppelClient } from "@doppelfun/sdk";
import {
  runProceduralMml,
  catalogEntriesToSeedBuildings,
  getCatalogIdsByCategory,
  getTrafficLightCatalogIds,
  CATEGORY_VEHICLES,
} from "@doppelfun/recipes";
import type { ClawStore } from "../../state/index.js";
import type { ClawConfig } from "../../config/index.js";
import { loadCatalogEntries } from "../catalog.js";
import { isDocumentIdUuid, DOCUMENT_ID_UUID_HINT } from "../documents.js";
import { clawLog } from "../../../util/log.js";
import type { BuildToolResult } from "../buildSteps.js";

/**
 * Run a recipe to generate MML (city, pyramid, grass, trees) via @doppelfun/recipes. No LLM.
 *
 * @param client - Engine client (createDocument, updateDocument, appendDocument)
 * @param store - Claw store (documentsByBlockSlot)
 * @param config - Claw config (for catalog when kind is city)
 * @param args - kind, documentMode (new|replace|append), documentId?, params?
 * @returns BuildToolResult with summary (e.g. "generated city scene (new document ...)")
 */
export async function handleRunRecipe(
  client: DoppelClient,
  store: ClawStore,
  config: ClawConfig,
  args: {
    kind: string;
    documentMode?: string;
    documentId?: string;
    params?: Record<string, unknown>;
  }
): Promise<BuildToolResult> {
  const kind = args.kind?.trim().toLowerCase() || "";
  clawLog("build: run_recipe", kind, "documentMode=" + (args.documentMode ?? "new"));
  const state = store.getState();
  if (!kind) {
    clawLog("build: run_recipe error", "missing kind");
    return { ok: false, error: "run_recipe requires kind (city, pyramid, grass, or trees)" };
  }

  const modeRaw = typeof args.documentMode === "string" ? args.documentMode.trim().toLowerCase() : "";
  const documentMode =
    modeRaw === "replace" || modeRaw === "replace_current" || modeRaw === "update"
      ? "replace"
      : modeRaw === "append" || modeRaw === "append_current"
        ? "append"
        : "new";

  const raw: Record<string, unknown> = {
    kind,
    documentMode,
    documentId: args.documentId,
    params: args.params ?? {},
  };

  // City recipe needs catalog for buildings and traffic
  if (kind === "city") {
    try {
      const catalog = await loadCatalogEntries(config);
      const buildings = catalogEntriesToSeedBuildings(catalog);
      const vehicleCatalogIds = getCatalogIdsByCategory(catalog, CATEGORY_VEHICLES);
      const trafficLightCatalogIds = getTrafficLightCatalogIds(catalog);
      const params = (raw.params as Record<string, unknown>) ?? {};
      if (buildings.length > 0) {
        (params as Record<string, unknown>).buildings = buildings.map(
          (b: { id: string; name: string; url: string; width?: number; depth?: number; height?: number }) => ({
            id: b.id,
            name: b.name,
            url: b.url,
            width: b.width,
            depth: b.depth,
            height: b.height,
          })
        );
      }
      if (vehicleCatalogIds.length > 0) (params as Record<string, unknown>).vehicleCatalogIds = vehicleCatalogIds;
      if (trafficLightCatalogIds.length > 0)
        (params as Record<string, unknown>).trafficLightCatalogIds = trafficLightCatalogIds;
      raw.params = params;
    } catch {
      // fallback: empty building list
    }
  }

  let mml: string;
  try {
    mml = runProceduralMml(kind, raw);
  } catch (e) {
    const err = e instanceof Error ? e.message : "run_recipe failed";
    clawLog("build: run_recipe error", err);
    return { ok: false, error: err };
  }

  const targetDocumentId =
    typeof args.documentId === "string" && args.documentId.trim() ? args.documentId.trim() : null;
  if (
    (documentMode === "replace" || documentMode === "append") &&
    targetDocumentId &&
    !isDocumentIdUuid(targetDocumentId)
  ) {
    return { ok: false, error: `run_recipe ${documentMode}: ${DOCUMENT_ID_UUID_HINT}` };
  }

  const blockDoc = state.documentsByBlockSlot[state.blockSlotId];
  const targetId =
    targetDocumentId && isDocumentIdUuid(targetDocumentId)
      ? targetDocumentId
      : blockDoc?.documentId ?? null;

  try {
    if (documentMode === "new") {
      const { documentId: newId } = await client.createDocument(mml);
      store.mergeDocumentsByBlockSlot(state.blockSlotId, { documentId: newId, mml });
      clawLog("build: run_recipe ok", kind, "new document", newId);
      return { ok: true, summary: `generated ${kind} scene (new document ${newId})` };
    }
    if (documentMode === "append") {
      if (targetId) {
        let priorMml = blockDoc?.documentId === targetId ? blockDoc.mml ?? "" : "";
        if (!priorMml && targetId) {
          try {
            const res = await client.getDocumentContent(targetId);
            priorMml = res.content;
          } catch {
            // append may still work
          }
        }
        await client.appendDocument(targetId, mml);
        const newMml = priorMml ? `${priorMml}\n${mml}` : mml;
        store.mergeDocumentsByBlockSlot(state.blockSlotId, { documentId: targetId, mml: newMml });
      } else {
        const { documentId: newId } = await client.createDocument(mml);
        store.mergeDocumentsByBlockSlot(state.blockSlotId, { documentId: newId, mml });
      }
      clawLog("build: run_recipe ok", kind, "appended");
      return { ok: true, summary: `generated ${kind} scene (appended)` };
    }
    if (targetId) {
      await client.updateDocument(targetId, mml);
      store.mergeDocumentsByBlockSlot(state.blockSlotId, { documentId: targetId, mml });
    } else {
      const { documentId: newId } = await client.createDocument(mml);
      store.mergeDocumentsByBlockSlot(state.blockSlotId, { documentId: newId, mml });
    }
    clawLog("build: run_recipe ok", kind, "replaced");
    return { ok: true, summary: `generated ${kind} scene (replaced)` };
  } catch (e) {
    const rawErr = e instanceof Error ? e.message : String(e);
    clawLog("build: run_recipe error", rawErr);
    const err = parseEngineError(rawErr);
    return { ok: false, error: err };
  }
}

/**
 * Prefer a short engine error message (e.g. from 413 JSON body) over the raw HTTP message.
 */
function parseEngineError(raw: string): string {
  const prefix = "run_recipe: ";
  const start = raw.indexOf("{");
  if (start >= 0) {
    try {
      const body = JSON.parse(raw.slice(start)) as { error?: string };
      if (typeof body.error === "string" && body.error.trim())
        return prefix + body.error.trim();
    } catch {
      // use raw
    }
  }
  return prefix + raw;
}
