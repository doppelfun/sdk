/**
 * Build subagent handler: generate_procedural.
 * Deterministic MML (city, pyramid, grass, trees) — no LLM. Uses @doppelfun/gen.
 */
import type { DoppelClient } from "@doppelfun/sdk";
import {
  runProceduralMml,
  catalogEntriesToSeedBuildings,
  getCatalogIdsByCategory,
  getTrafficLightCatalogIds,
  CATEGORY_VEHICLES,
} from "@doppelfun/gen";
import type { ClawStore } from "../../../../state/index.js";
import type { ClawConfig } from "../../../../config/index.js";
import { loadCatalogEntries } from "../../../../build/catalog.js";
import { isDocumentIdUuid, DOCUMENT_ID_UUID_HINT } from "../../../../build/documents.js";
import { clawLog } from "../../../../log.js";
import type { BuildToolResult } from "../buildSteps.js";

/**
 * Generate procedural MML (city, pyramid, grass, trees) via @doppelfun/gen. No LLM.
 *
 * @param client - Engine client (createDocument, updateDocument, appendDocument)
 * @param store - Claw store (documentsByBlockSlot)
 * @param config - Claw config (for catalog when kind is city)
 * @param args - kind, documentMode (new|replace|append), documentId?, params?
 * @returns BuildToolResult with summary (e.g. "generated city scene (new document ...)")
 */
export async function handleGenerateProcedural(
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
  clawLog("build: generate_procedural", kind, "documentMode=" + (args.documentMode ?? "new"));
  const state = store.getState();
  if (!kind) {
    clawLog("build: generate_procedural error", "missing kind");
    return { ok: false, error: "generate_procedural requires kind (city, pyramid, grass, or trees)" };
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

  // City kind needs catalog for buildings and traffic
  if (kind === "city") {
    try {
      const catalog = await loadCatalogEntries(config);
      const buildings = catalogEntriesToSeedBuildings(catalog);
      const vehicleCatalogIds = getCatalogIdsByCategory(catalog, CATEGORY_VEHICLES);
      const trafficLightCatalogIds = getTrafficLightCatalogIds(catalog);
      const params = (raw.params as Record<string, unknown>) ?? {};
      if (buildings.length > 0) {
        (params as Record<string, unknown>).buildings = buildings.map((b) => ({
          id: b.id,
          name: b.name,
          url: b.url,
          width: b.width,
          depth: b.depth,
          height: b.height,
        }));
      }
      if (vehicleCatalogIds.length > 0) (params as Record<string, unknown>).vehicleCatalogIds = vehicleCatalogIds;
      if (trafficLightCatalogIds.length > 0)
        (params as Record<string, unknown>).trafficLightCatalogIds = trafficLightCatalogIds;
      raw.params = params;
    } catch {
      // fallback: gen uses empty building list
    }
  }

  let mml: string;
  try {
    mml = runProceduralMml(kind, raw);
  } catch (e) {
    const err = e instanceof Error ? e.message : "generate_procedural failed";
    clawLog("build: generate_procedural error", err);
    return { ok: false, error: err };
  }

  const proceduralDocumentId =
    typeof args.documentId === "string" && args.documentId.trim() ? args.documentId.trim() : null;
  if (
    (documentMode === "replace" || documentMode === "append") &&
    proceduralDocumentId &&
    !isDocumentIdUuid(proceduralDocumentId)
  ) {
    return { ok: false, error: `generate_procedural ${documentMode}: ${DOCUMENT_ID_UUID_HINT}` };
  }

  const blockDoc = state.documentsByBlockSlot[state.blockSlotId];
  const targetId =
    proceduralDocumentId && isDocumentIdUuid(proceduralDocumentId)
      ? proceduralDocumentId
      : blockDoc?.documentId ?? null;

  try {
    if (documentMode === "new") {
      const { documentId: newId } = await client.createDocument(mml);
      store.mergeDocumentsByBlockSlot(state.blockSlotId, { documentId: newId, mml });
      clawLog("build: generate_procedural ok", kind, "new document", newId);
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
      clawLog("build: generate_procedural ok", kind, "appended");
      return { ok: true, summary: `generated ${kind} scene (appended)` };
    }
    if (targetId) {
      await client.updateDocument(targetId, mml);
      store.mergeDocumentsByBlockSlot(state.blockSlotId, { documentId: targetId, mml });
    } else {
      const { documentId: newId } = await client.createDocument(mml);
      store.mergeDocumentsByBlockSlot(state.blockSlotId, { documentId: newId, mml });
    }
    clawLog("build: generate_procedural ok", kind, "replaced");
    return { ok: true, summary: `generated ${kind} scene (replaced)` };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    clawLog("build: generate_procedural error", err);
    return { ok: false, error: `generate_procedural: ${err}` };
  }
}
