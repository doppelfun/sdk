import { runProceduralMml, catalogEntriesToSeedBuildings } from "@doppelfun/gen";
import type { ToolContext } from "../types.js";
import { syncMainDocumentForBlock } from "../../state/state.js";
import { clawLog } from "../../log.js";
import { loadCatalogEntries } from "../shared/catalog.js";
import { ownerGateDenied } from "../shared/gate.js";
import { isDocumentIdUuid, DOCUMENT_ID_UUID_HINT } from "../shared/documents.js";

export async function handleGenerateProcedural(ctx: ToolContext) {
  const { client, state, config, args, logAction } = ctx;
  const denied = ownerGateDenied(config, state);
  if (denied) return denied;
  const kind = typeof args.kind === "string" ? args.kind.trim() : "";
  if (!kind) {
    return {
      ok: false,
      error: "generate_procedural requires kind (see @doppelfun/gen listProceduralKinds)",
    };
  }

  const modeRaw =
    typeof args.documentMode === "string" ? args.documentMode.trim().toLowerCase() : "";
  const documentMode =
    modeRaw === "replace" || modeRaw === "replace_current" || modeRaw === "update"
      ? "replace"
      : modeRaw === "append" || modeRaw === "append_current"
        ? "append"
        : "new";

  const raw = { ...(args as Record<string, unknown>) };
  const kindLower = kind.trim().toLowerCase();
  if (kindLower === "pyramid") {
    const hoist: [string, string][] = [
      ["cornerColors", "cornerColors"],
      ["corner_colors", "cornerColors"],
      ["cornerEmissionIntensity", "cornerEmissionIntensity"],
      ["corner_emission_intensity", "cornerEmissionIntensity"],
    ];
    let params =
      raw.params && typeof raw.params === "object" && !Array.isArray(raw.params)
        ? ({ ...(raw.params as Record<string, unknown>) } as Record<string, unknown>)
        : null;
    for (const [from, to] of hoist) {
      if (raw[from] !== undefined && (!params || params[to] === undefined)) {
        if (!params) params = {};
        params[to] = raw[from];
      }
    }
    if (params) raw.params = params;
  }

  if (kindLower === "city") {
    try {
      const catalog = await loadCatalogEntries(config);
      const buildings = catalogEntriesToSeedBuildings(catalog);
      if (buildings.length > 0) {
        const params =
          raw.params && typeof raw.params === "object" && !Array.isArray(raw.params)
            ? ({ ...(raw.params as Record<string, unknown>) } as Record<string, unknown>)
            : {};
        params.buildings = buildings.map((b) => ({ id: b.id, name: b.name, url: b.url }));
        raw.params = params;
      }
    } catch {
      // fall back to static SEED_BUILDINGS inside gen
    }
  }

  let mml: string;
  try {
    mml = runProceduralMml(kindLower, raw);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "generate_procedural failed" };
  }

  const proceduralDocumentId =
    typeof args.documentId === "string" && args.documentId.trim() ? args.documentId.trim() : null;
  if (
    (documentMode === "replace" || documentMode === "append") &&
    proceduralDocumentId &&
    !isDocumentIdUuid(proceduralDocumentId)
  ) {
    return {
      ok: false,
      error: `generate_procedural ${documentMode}: ${DOCUMENT_ID_UUID_HINT}`,
    };
  }

  const applyMml = async (mmlInner: string, baseSummary: string) => {
    const blockDoc = state.documentsByBlockSlot[state.blockSlotId];
    const targetId =
      proceduralDocumentId && isDocumentIdUuid(proceduralDocumentId)
        ? proceduralDocumentId
        : blockDoc?.documentId ?? null;

    if (documentMode === "new") {
      const { documentId: newId } = await client.createDocument(mmlInner);
      state.documentsByBlockSlot[state.blockSlotId] = { documentId: newId, mml: mmlInner };
      syncMainDocumentForBlock(state);
      return { ok: true as const, summary: `${baseSummary} (new document ${newId})` };
    }

    if (documentMode === "append") {
      if (targetId) {
        let priorMml = blockDoc?.documentId === targetId ? blockDoc.mml ?? "" : "";
        if (!priorMml && targetId) {
          try {
            const res = await client.getDocumentContent(targetId);
            priorMml = res.content;
          } catch {
            // append API may still work; state mml best-effort
          }
        }
        await client.appendDocument(targetId, mmlInner);
        const newMml = priorMml ? `${priorMml}\n${mmlInner}` : mmlInner;
        state.documentsByBlockSlot[state.blockSlotId] = { documentId: targetId, mml: newMml };
      } else {
        const { documentId: newId } = await client.createDocument(mmlInner);
        state.documentsByBlockSlot[state.blockSlotId] = { documentId: newId, mml: mmlInner };
      }
      syncMainDocumentForBlock(state);
      return { ok: true as const, summary: `${baseSummary} (appended)` };
    }

    if (targetId) {
      await client.updateDocument(targetId, mmlInner);
      state.documentsByBlockSlot[state.blockSlotId] = { documentId: targetId, mml: mmlInner };
    } else {
      const { documentId: newId } = await client.createDocument(mmlInner);
      state.documentsByBlockSlot[state.blockSlotId] = { documentId: newId, mml: mmlInner };
    }
    syncMainDocumentForBlock(state);
    return { ok: true as const, summary: `${baseSummary} (replaced)` };
  };

  const summaryLabel = `generated ${kind.trim().toLowerCase()} scene`;
  try {
    const procResult = await applyMml(mml, summaryLabel);
    if (procResult.ok && procResult.summary) logAction(procResult.summary);
    return procResult;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    clawLog("tool generate_procedural failed", msg);
    return { ok: false, error: `generate_procedural: ${msg}` };
  }
}
