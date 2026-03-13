import type { ToolContext } from "../types.js";
import { clawLog } from "../../log.js";
import {
  cacheDocumentsList,
  invalidateDocumentListCache,
  resolveDocumentIdTarget,
  clearTrackedDocumentIfDeleted,
  DOC_LIST_TOOL_RETURN_MAX_CHARS,
} from "../shared/documents.js";
import { ownerGateDenied } from "../shared/gate.js";

export async function handleListDocuments(ctx: ToolContext) {
  const { client, state, logAction } = ctx;
  const ids = await client.listDocuments();
  const { summaryForTool } = cacheDocumentsList(state, ids);
  logAction(summaryForTool);
  return { ok: true, summary: summaryForTool };
}

export async function handleGetDocumentContent(ctx: ToolContext) {
  const { client, state, config, args, logAction } = ctx;
  const denied = ownerGateDenied(config, state);
  if (denied) return denied;
  const resolved = await resolveDocumentIdTarget(args, state, client, "get_document_content");
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const res = await client.getDocumentContent(resolved.id);
  const preview =
    res.content.length > DOC_LIST_TOOL_RETURN_MAX_CHARS
      ? res.content.slice(0, DOC_LIST_TOOL_RETURN_MAX_CHARS) +
        "\n… (truncated in summary; full in tool result)"
      : res.content;
  const truncatedNote = res.truncated ? ` server truncated at ${res.totalChars ?? "?"} chars` : "";
  const summary = `document ${res.documentId} (${res.content.length} chars${truncatedNote})\n${preview}`;
  logAction(`get_document_content ${res.documentId} (${res.content.length} chars)`);
  return { ok: true, summary };
}

export async function handleDeleteDocument(ctx: ToolContext) {
  const { client, state, config, args, logAction } = ctx;
  const denied = ownerGateDenied(config, state);
  if (denied) return denied;
  const resolved = await resolveDocumentIdTarget(args, state, client, "delete_document");
  if (!resolved.ok) return { ok: false, error: resolved.error };
  await client.deleteDocument(resolved.id);
  invalidateDocumentListCache(state);
  clearTrackedDocumentIfDeleted(state, resolved.id);
  const summary = `deleted document ${resolved.id}`;
  logAction(summary);
  return { ok: true, summary };
}

export async function handleDeleteAllDocuments(ctx: ToolContext) {
  const { client, state, config, logAction } = ctx;
  const denied = ownerGateDenied(config, state);
  if (denied) return denied;
  const ids = await client.listDocuments();
  if (ids.length === 0) {
    state.lastDocumentsList = "0 documents";
    logAction("no documents to delete");
    return { ok: true, summary: "no documents to delete" };
  }
  const trackedId = state.documentsByBlockSlot[state.blockSlotId]?.documentId ?? null;
  let deleted = 0;
  for (const id of ids) {
    try {
      await client.deleteDocument(id);
      deleted += 1;
    } catch (e) {
      clawLog("delete_all_documents failed for id", id, e instanceof Error ? e.message : String(e));
    }
  }
  if (trackedId && ids.includes(trackedId)) {
    clearTrackedDocumentIfDeleted(state, trackedId);
  }
  state.lastDocumentsList = deleted === ids.length ? "0 documents" : null;
  const summary = `deleted ${deleted}/${ids.length} document(s)`;
  logAction(summary);
  return { ok: true, summary };
}
