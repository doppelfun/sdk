/**
 * Build subagent handlers: list_documents, get_document_content, delete_document, delete_all_documents.
 * Document ops are used to target replace/append and to verify or clear builds.
 */
import type { DoppelClient } from "@doppelfun/sdk";
import type { ClawStore } from "../../../../state/index.js";
import type { ClawConfig } from "../../../../config/index.js";
import {
  cacheDocumentsList,
  resolveDocumentIdTarget,
  clearTrackedDocumentIfDeleted,
  DOC_LIST_TOOL_RETURN_MAX_CHARS,
} from "../../../../build/documents.js";
import { clawLog } from "../../../../log.js";
import type { BuildToolResult } from "../buildSteps.js";

/** List document UUIDs in the block (for replace/append/delete targeting). */
export async function handleListDocuments(
  client: DoppelClient,
  store: ClawStore,
  _config: ClawConfig,
  _args: Record<string, unknown>
): Promise<BuildToolResult> {
  clawLog("build: list_documents");
  const ids = await client.listDocuments();
  const { summaryForTool } = cacheDocumentsList(store, ids);
  clawLog("build: list_documents ok", ids.length, "documents");
  return { ok: true, summary: summaryForTool };
}

/** Read stored MML for a document (documentId or target current|last). */
export async function handleGetDocumentContent(
  client: DoppelClient,
  store: ClawStore,
  _config: ClawConfig,
  args: { documentId?: string; target?: string }
): Promise<BuildToolResult> {
  clawLog("build: get_document_content", args.documentId ?? args.target ?? "(target)");
  const state = store.getState();
  const resolved = await resolveDocumentIdTarget(args, state, client, "get_document_content");
  if (!resolved.ok) {
    clawLog("build: get_document_content error", resolved.error);
    return { ok: false, error: resolved.error };
  }
  const res = await client.getDocumentContent(resolved.id);
  clawLog("build: get_document_content ok", res.documentId, res.content.length, "chars");
  const preview =
    res.content.length > DOC_LIST_TOOL_RETURN_MAX_CHARS
      ? res.content.slice(0, DOC_LIST_TOOL_RETURN_MAX_CHARS) + "\n… (truncated)"
      : res.content;
  const summary = `document ${res.documentId} (${res.content.length} chars)\n${preview}`;
  return { ok: true, summary };
}

/** Delete one document (documentId or target current|last). */
export async function handleDeleteDocument(
  client: DoppelClient,
  store: ClawStore,
  _config: ClawConfig,
  args: { documentId?: string; target?: string }
): Promise<BuildToolResult> {
  clawLog("build: delete_document", args.documentId ?? args.target ?? "(target)");
  const state = store.getState();
  const resolved = await resolveDocumentIdTarget(args, state, client, "delete_document");
  if (!resolved.ok) {
    clawLog("build: delete_document error", resolved.error);
    return { ok: false, error: resolved.error };
  }
  await client.deleteDocument(resolved.id);
  clearTrackedDocumentIfDeleted(store, resolved.id);
  store.setLastDocumentsList(null);
  clawLog("build: delete_document ok", resolved.id);
  return { ok: true, summary: `deleted document ${resolved.id}` };
}

/** Delete every agent-owned document in the block. */
export async function handleDeleteAllDocuments(
  client: DoppelClient,
  store: ClawStore,
  _config: ClawConfig,
  _args: Record<string, unknown>
): Promise<BuildToolResult> {
  clawLog("build: delete_all_documents");
  const ids = await client.listDocuments();
  const state = store.getState();
  if (ids.length === 0) {
    clawLog("build: delete_all_documents ok", "0 documents");
    store.setLastDocumentsList("0 documents");
    return { ok: true, summary: "no documents to delete" };
  }
  const trackedId = state.documentsByBlockSlot[state.blockSlotId]?.documentId ?? null;
  let deleted = 0;
  for (const id of ids) {
    try {
      await client.deleteDocument(id);
      deleted += 1;
    } catch (e) {
      clawLog("build: delete_all_documents skip", id, e instanceof Error ? e.message : String(e));
    }
  }
  if (trackedId && ids.includes(trackedId)) {
    clearTrackedDocumentIfDeleted(store, trackedId);
  }
  store.setLastDocumentsList(deleted === ids.length ? "0 documents" : null);
  clawLog("build: delete_all_documents ok", deleted, "/", ids.length);
  return { ok: true, summary: `deleted ${deleted}/${ids.length} document(s)` };
}
