import type { ToolContext } from "../types.js";
import { getBlockBounds } from "../../../util/blockBounds.js";
import { buildIncremental } from "../../llm/buildLlm.js";
import { createLlmProvider } from "../../llm/index.js";
import { getCatalogForBuild, catalogToJson } from "../shared/catalog.js";
import { ownerGateDenied, preCheckBalance, reportBuildUsage } from "../shared/gate.js";
import { isDocumentIdUuid, DOCUMENT_ID_UUID_HINT } from "../shared/documents.js";
import { parsePositionHint } from "../../../util/position.js";

export async function handleBuildIncremental(ctx: ToolContext) {
  const { client, store, config, args, logAction } = ctx;
  const state = store.getState();
  const instruction = typeof args.instruction === "string" ? args.instruction.trim() : "";
  if (!instruction) return { ok: false, error: "build_incremental requires instruction" };
  const denied = ownerGateDenied(config, state);
  if (denied) return denied;
  const balErr = await preCheckBalance(config);
  if (balErr) return { ok: false, error: balErr };
  const positionHint = typeof args.position === "string" ? args.position.trim() : undefined;
  if (positionHint) {
    const parsed = parsePositionHint(positionHint);
    if (parsed) {
      store.setMovementIntent(null);
      store.setLastBuildTarget({ x: parsed.x, z: parsed.z });
      store.setMovementTarget({ x: parsed.x, z: parsed.z });
    }
  }
  const catalog = await getCatalogForBuild(config);
  const blockDoc = state.documentsByBlockSlot[state.blockSlotId];
  const explicitId =
    typeof args.documentId === "string" && args.documentId.trim() ? args.documentId.trim() : null;
  if (explicitId && !isDocumentIdUuid(explicitId)) {
    return { ok: false, error: `build_incremental: ${DOCUMENT_ID_UUID_HINT}` };
  }
  const targetRaw =
    typeof args.documentTarget === "string" ? args.documentTarget.trim().toLowerCase() : "";
  const appendByTarget = targetRaw === "append_current" || targetRaw === "append";
  const wantAppend =
    appendByTarget || (explicitId && blockDoc && explicitId === blockDoc.documentId);

  let appendTargetId: string | null = null;
  if (wantAppend) {
    if (appendByTarget && explicitId && isDocumentIdUuid(explicitId)) {
      appendTargetId = explicitId;
    } else if (appendByTarget && blockDoc) {
      appendTargetId = blockDoc.documentId;
    } else if (explicitId && blockDoc && explicitId === blockDoc.documentId) {
      appendTargetId = blockDoc.documentId;
    }
  }

  let existingMml = blockDoc?.mml ?? "";
  if (wantAppend && appendTargetId && (!blockDoc || appendTargetId !== blockDoc.documentId)) {
    try {
      const res = await client.getDocumentContent(appendTargetId);
      existingMml = res.content;
    } catch {
      return {
        ok: false,
        error: `build_incremental: could not load document ${appendTargetId} for append—check list_documents`,
      };
    }
  }
  const blockBounds = getBlockBounds(state.blockSlotId);
  client.sendThinking(true);
  let result: Awaited<ReturnType<typeof buildIncremental>>;
  try {
    result = await buildIncremental(
      createLlmProvider(config),
      config.buildLlmModel,
      instruction,
      existingMml,
      catalogToJson(catalog),
      blockBounds,
      positionHint
    );
  } finally {
    client.sendThinking(false);
  }
  if (!result.ok) return result;
  reportBuildUsage(config, result.usage);
  const fragment = result.mml;

  if (!wantAppend) {
    const { documentId: newId } = await client.createDocument(fragment);
    store.mergeDocumentsByBlockSlot(state.blockSlotId, { documentId: newId, mml: fragment });
    store.syncMainDocumentForBlock();
    const s1 = `built fragment as new document ${newId}`;
    logAction(s1);
    return { ok: true, summary: s1 };
  }

  const idToAppend = appendTargetId ?? blockDoc?.documentId ?? null;
  if (!idToAppend) {
    const { documentId: newId } = await client.createDocument(fragment);
    store.mergeDocumentsByBlockSlot(state.blockSlotId, { documentId: newId, mml: fragment });
    store.syncMainDocumentForBlock();
    const s2 = `built fragment as new document ${newId} (no doc to append to)`;
    logAction(s2);
    return { ok: true, summary: s2 };
  }
  const newMml = existingMml ? `${existingMml}\n${fragment}` : fragment;
  await client.appendDocument(idToAppend, fragment);
  store.mergeDocumentsByBlockSlot(state.blockSlotId, { documentId: idToAppend, mml: newMml });
  store.syncMainDocumentForBlock();
  const s3 = `appended to document ${idToAppend}`;
  logAction(s3);
  return { ok: true, summary: s3 };
}
