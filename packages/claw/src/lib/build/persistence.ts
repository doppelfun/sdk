/**
 * Persist MML from build_full / build_with_code: always create a new document.
 */
import type { DoppelClient } from "@doppelfun/sdk";
import type { ClawStore } from "../state/store.js";
import { clawLog } from "../../util/log.js";

/** Result of persisting a full-scene MML (create new document). */
export type PersistBuildResult =
  | { ok: true; summary: string }
  | { ok: false; error: string };

/** Timeout (ms) for createDocument so we don't hang if the server never responds. */
const PERSIST_CREATE_DOCUMENT_TIMEOUT_MS = 120_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

/**
 * Persist full-scene MML: always create a new document (so user can delete/edit the latest only).
 * Replace/update paths are disabled.
 *
 * @param client - Engine client (createDocument)
 * @param store - Claw store (mergeDocumentsByBlockSlot)
 * @param mml - Full MML string
 * @param _args - documentTarget/documentId ignored; always create new
 * @returns PersistBuildResult
 */
export async function persistFullBuildMml(
  client: DoppelClient,
  store: ClawStore,
  mml: string,
  _args: Record<string, unknown>
): Promise<PersistBuildResult> {
  const state = store.getState();
  clawLog("build: persist createDocument request", "mml length=" + mml.length);
  let newId: string;
  try {
    const result = await withTimeout(
      client.createDocument(mml),
      PERSIST_CREATE_DOCUMENT_TIMEOUT_MS,
      "createDocument"
    );
    newId = result.documentId;
    clawLog("build: persist createDocument ok", "documentId=" + newId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    clawLog("build: persist createDocument failed:", msg);
    return { ok: false, error: msg };
  }
  store.mergeDocumentsByBlockSlot(state.blockSlotId, { documentId: newId, mml });
  return { ok: true, summary: `built full scene (new document ${newId})` };
}
