/**
 * run_recipe handler: run a recipe via @doppelfun/recipes (no LLM).
 * Output behavior: mml → write to document; message / json → return string to agent (no document).
 */
import type { DoppelClient } from "@doppelfun/sdk";
import {
  runRecipe,
  getRecipeManifests,
  RECIPE_INJECT_KEYS,
  type RecipeInjectKey,
  type RecipeOutputType,
} from "@doppelfun/recipes";
import type { ClawStore } from "../../state/index.js";
import type { ClawConfig } from "../../config/index.js";
import { loadCatalogEntries } from "../catalog.js";
import { isDocumentIdUuid, DOCUMENT_ID_UUID_HINT } from "../documents.js";
import { clawLog } from "../../../util/log.js";
import type { BuildToolResult } from "../buildSteps.js";

/** Normalize documentMode from tool args. */
function normalizeDocumentMode(raw: string): "new" | "replace" | "append" {
  const mode = raw.trim().toLowerCase();
  if (mode === "replace" || mode === "replace_current" || mode === "update") return "replace";
  if (mode === "append" || mode === "append_current") return "append";
  return "new";
}

/**
 * Run a recipe; behavior depends on manifest.output.
 * If "mml": create/update/append a document with the output. If "message" or "json": return output to the agent (no document).
 * If the recipe manifest lists "inject" keys (e.g. "catalog"), we load that state and add it to params.
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

  const manifests = getRecipeManifests();
  const knownKinds = manifests.map((m) => m.id).join(", ");
  if (!kind) {
    clawLog("build: run_recipe error", "missing kind");
    return { ok: false, error: `run_recipe requires kind (one of: ${knownKinds}). Call list_recipes.` };
  }

  const documentMode = normalizeDocumentMode(
    typeof args.documentMode === "string" ? args.documentMode : ""
  );
  const raw: Record<string, unknown> = {
    kind,
    documentMode,
    documentId: args.documentId,
    params: { ...(args.params ?? {}) },
  };

  // Inject only allowed state keys; any other key in manifest.inject is ignored
  const manifest = manifests.find((m) => m.id.trim().toLowerCase() === kind);
  const injectAllowSet = new Set(RECIPE_INJECT_KEYS);
  const requestedInject = Array.isArray(manifest?.inject) ? manifest.inject : [];
  const allowedKeys: RecipeInjectKey[] = requestedInject.filter((k) =>
    injectAllowSet.has(k as RecipeInjectKey)
  );
  if (allowedKeys.length > 0) {
    const params = raw.params as Record<string, unknown>;
    if (allowedKeys.includes("catalog")) {
      try {
        const catalog = await loadCatalogEntries(config);
        if (catalog.length > 0) params.catalog = catalog;
      } catch {
        /* omit catalog on failure */
      }
    }
    if (allowedKeys.includes("currentDocument")) {
      const state = store.getState();
      const blockDoc = state.documentsByBlockSlot[state.blockSlotId];
      params.currentDocument = blockDoc?.mml ?? null;
    }
    if (allowedKeys.includes("occupants")) {
      const state = store.getState();
      params.occupants = state.occupants;
    }
  }

  let output: string;
  try {
    output = runRecipe(kind, raw);
  } catch (e) {
    const err = e instanceof Error ? e.message : "run_recipe failed";
    clawLog("build: run_recipe error", err);
    return { ok: false, error: err };
  }

  const outputType: RecipeOutputType = manifest?.output ?? "mml";

  // message / json: return output to agent; no document write
  if (outputType === "message") {
    clawLog("build: run_recipe ok", kind, "message");
    return { ok: true, summary: output || `Recipe ${kind} produced no message.` };
  }
  if (outputType === "json") {
    clawLog("build: run_recipe ok", kind, "json");
    return { ok: true, summary: output || "{}" };
  }

  // mml: write to document
  const state = store.getState();
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
      const { documentId: newId } = await client.createDocument(output);
      store.mergeDocumentsByBlockSlot(state.blockSlotId, { documentId: newId, mml: output });
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
            /* append may still work */
          }
        }
        await client.appendDocument(targetId, output);
        const newMml = priorMml ? `${priorMml}\n${output}` : output;
        store.mergeDocumentsByBlockSlot(state.blockSlotId, { documentId: targetId, mml: newMml });
      } else {
        const { documentId: newId } = await client.createDocument(output);
        store.mergeDocumentsByBlockSlot(state.blockSlotId, { documentId: newId, mml: output });
      }
      clawLog("build: run_recipe ok", kind, "appended");
      return { ok: true, summary: `generated ${kind} scene (appended)` };
    }
    if (targetId) {
      await client.updateDocument(targetId, output);
      store.mergeDocumentsByBlockSlot(state.blockSlotId, { documentId: targetId, mml: output });
    } else {
      const { documentId: newId } = await client.createDocument(output);
      store.mergeDocumentsByBlockSlot(state.blockSlotId, { documentId: newId, mml: output });
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
