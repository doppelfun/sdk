/**
 * Persist MML from build_full / build_with_code: create or update document + state.
 */
import type { DoppelClient } from "@doppelfun/sdk";
import type { ClawStore } from "../state/store.js";
import { isDocumentIdUuid, DOCUMENT_ID_UUID_HINT } from "./documents.js";

export type PersistBuildResult =
  | { ok: true; summary: string }
  | { ok: false; error: string };

export async function persistFullBuildMml(
  client: DoppelClient,
  store: ClawStore,
  mml: string,
  args: Record<string, unknown>
): Promise<PersistBuildResult> {
  const state = store.getState();
  const targetRaw =
    typeof args.documentTarget === "string" ? args.documentTarget.trim().toLowerCase() : "";
  const wantReplace =
    targetRaw === "replace_current" || targetRaw === "replace" || targetRaw === "update";

  if (!wantReplace) {
    const { documentId: newId } = await client.createDocument(mml);
    store.mergeDocumentsByBlockSlot(state.blockSlotId, { documentId: newId, mml });
    return { ok: true, summary: `built full scene (new document ${newId})` };
  }

  const explicitId =
    typeof args.documentId === "string" && args.documentId.trim() ? args.documentId.trim() : null;
  if (explicitId) {
    if (!isDocumentIdUuid(explicitId)) {
      return { ok: false, error: `build_full replace/update: ${DOCUMENT_ID_UUID_HINT}` };
    }
    await client.updateDocument(explicitId, mml);
    store.mergeDocumentsByBlockSlot(state.blockSlotId, { documentId: explicitId, mml });
    return { ok: true, summary: `built full scene (updated ${explicitId})` };
  }

  const blockDoc = state.documentsByBlockSlot[state.blockSlotId];
  if (blockDoc) {
    await client.updateDocument(blockDoc.documentId, mml);
    store.mergeDocumentsByBlockSlot(state.blockSlotId, { documentId: blockDoc.documentId, mml });
    return { ok: true, summary: "built full scene (replaced current)" };
  }
  const { documentId: newId } = await client.createDocument(mml);
  store.mergeDocumentsByBlockSlot(state.blockSlotId, { documentId: newId, mml });
  return { ok: true, summary: `built full scene (new document ${newId})` };
}
