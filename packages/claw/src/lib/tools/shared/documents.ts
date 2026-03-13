/**
 * Document list cache, UUID validation, and resolve documentId/target for document tools.
 */

import type { DoppelClient } from "@doppelfun/sdk";
import type { ClawState } from "../../state/state.js";
import { syncMainDocumentForBlock } from "../../state/state.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isDocumentIdUuid(id: string): boolean {
  return typeof id === "string" && UUID_RE.test(id.trim());
}

export const DOCUMENT_ID_UUID_HINT =
  "documentId must be a UUID from list_documents only—not a filename. For replace/append/delete, pass the id explicitly; for new builds omit documentId.";

export const DOC_LIST_CACHE_MAX_CHARS = 6000;
export const DOC_LIST_TOOL_RETURN_MAX_CHARS = 4000;

export function cacheDocumentsList(
  state: ClawState,
  ids: string[]
): { summaryForTool: string } {
  const fullSummary =
    ids.length === 0 ? "0 documents" : `${ids.length} document(s): ${ids.join(", ")}`;
  let summaryForTool = fullSummary;
  if (fullSummary.length > DOC_LIST_TOOL_RETURN_MAX_CHARS) {
    const head = ids.slice(0, 40).join(", ");
    summaryForTool = `${ids.length} document(s); first 40: ${head}… (truncated; re-call with care if you need every id)`;
  }
  if (fullSummary.length <= DOC_LIST_CACHE_MAX_CHARS) {
    state.lastDocumentsList = fullSummary;
  } else {
    const head = ids.slice(0, 80).join(", ");
    state.lastDocumentsList = `${ids.length} document(s); first 80: ${head}… (truncated in cache; re-call list_documents if you need every id)`;
  }
  return { summaryForTool };
}

export function invalidateDocumentListCache(state: ClawState): void {
  state.lastDocumentsList = null;
}

export async function resolveDocumentIdTarget(
  args: { documentId?: string; target?: string },
  state: ClawState,
  client: DoppelClient,
  toolName: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const explicitId =
    typeof args.documentId === "string" && args.documentId.trim() ? args.documentId.trim() : null;
  const targetRaw = typeof args.target === "string" ? args.target.trim().toLowerCase() : "";

  if (explicitId) {
    if (!isDocumentIdUuid(explicitId)) {
      return { ok: false, error: `${toolName}: ${DOCUMENT_ID_UUID_HINT}` };
    }
    return { ok: true, id: explicitId };
  }

  if (targetRaw === "current") {
    const id = state.documentsByBlockSlot[state.blockSlotId]?.documentId ?? null;
    if (!id) return { ok: false, error: `${toolName} target current but no tracked document` };
    return { ok: true, id };
  }

  if (targetRaw === "last") {
    const ids = await client.listDocuments();
    if (ids.length === 0) return { ok: false, error: `${toolName} target last but no documents` };
    return { ok: true, id: ids[ids.length - 1]! };
  }

  return { ok: false, error: `${toolName} requires documentId or target current|last` };
}

export function clearTrackedDocumentIfDeleted(state: ClawState, deletedId: string): void {
  const blockDoc = state.documentsByBlockSlot[state.blockSlotId];
  if (blockDoc?.documentId === deletedId) {
    delete state.documentsByBlockSlot[state.blockSlotId];
    syncMainDocumentForBlock(state);
  }
}
