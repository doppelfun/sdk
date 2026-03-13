/**
 * Persist MML from build_full / build_with_code: create or update document + state sync.
 */

import type { DoppelClient } from "@doppelfun/sdk";
import type { ClawState } from "../../state/state.js";
import { syncMainDocumentForBlock } from "../../state/state.js";
import { isDocumentIdUuid, DOCUMENT_ID_UUID_HINT } from "./documents.js";
import type { ExecuteToolResult } from "../types.js";

export async function persistFullBuildMml(
  client: DoppelClient,
  state: ClawState,
  mml: string,
  args: Record<string, unknown>
): Promise<ExecuteToolResult> {
  const targetRaw =
    typeof args.documentTarget === "string" ? args.documentTarget.trim().toLowerCase() : "";
  const wantReplace =
    targetRaw === "replace_current" || targetRaw === "replace" || targetRaw === "update";

  if (!wantReplace) {
    const { documentId: newId } = await client.createDocument(mml);
    state.documentsByBlockSlot[state.blockSlotId] = { documentId: newId, mml };
    syncMainDocumentForBlock(state);
    return { ok: true, summary: `built full scene (new document ${newId})` };
  }

  const explicitId =
    typeof args.documentId === "string" && args.documentId.trim() ? args.documentId.trim() : null;
  if (explicitId) {
    if (!isDocumentIdUuid(explicitId)) {
      return { ok: false, error: `build_full replace/update: ${DOCUMENT_ID_UUID_HINT}` };
    }
    await client.updateDocument(explicitId, mml);
    state.documentsByBlockSlot[state.blockSlotId] = { documentId: explicitId, mml };
    syncMainDocumentForBlock(state);
    return { ok: true, summary: `built full scene (updated ${explicitId})` };
  }

  const blockDoc = state.documentsByBlockSlot[state.blockSlotId];
  if (blockDoc) {
    await client.updateDocument(blockDoc.documentId, mml);
    state.documentsByBlockSlot[state.blockSlotId] = { documentId: blockDoc.documentId, mml };
  } else {
    const { documentId: newId } = await client.createDocument(mml);
    state.documentsByBlockSlot[state.blockSlotId] = { documentId: newId, mml };
  }
  syncMainDocumentForBlock(state);
  return { ok: true, summary: "built full scene (replaced current)" };
}
