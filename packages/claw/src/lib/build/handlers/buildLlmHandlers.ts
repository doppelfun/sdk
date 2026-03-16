/**
 * Build handlers: build_full, build_incremental, build_with_code.
 * Multistep flows with shared step logging; each step logs what happens and what to do on failure.
 */
import type { DoppelClient } from "@doppelfun/sdk";
import type { ClawStore } from "../../state/index.js";
import type { ClawConfig } from "../../config/index.js";
import { buildFull, buildIncremental, buildFullWithCodeExecution } from "../../llm/buildLlm.js";
import { persistFullBuildMml } from "../persistence.js";
import { reportUsageToHub } from "../../credits/index.js";
import { isDocumentIdUuid, DOCUMENT_ID_UUID_HINT } from "../documents.js";
import {
  type BuildToolResult,
  logStep,
  logStepOk,
  logStepFailed,
  withThinking,
  resolveModelAndCatalog,
  truncateForLog,
} from "../buildSteps.js";
import { getBlockBounds } from "../../../util/blockBounds.js";
import { catalogToJson } from "../catalog.js";
import { clawLog } from "../../../util/log.js";

const TOOL_BUILD_FULL = "build_full";
const TOOL_BUILD_INCREMENTAL = "build_incremental";
const TOOL_BUILD_WITH_CODE = "build_with_code";

/**
 * build_full: validate instruction → resolve model+catalog → call LLM (buildFull) → persist MML.
 */
export async function handleBuildFull(
  client: DoppelClient,
  store: ClawStore,
  config: ClawConfig,
  args: { instruction?: string; documentTarget?: string; documentId?: string }
): Promise<BuildToolResult> {
  const instruction = typeof args.instruction === "string" ? args.instruction.trim() : "";

  logStep(TOOL_BUILD_FULL, 1, 4, "validate", "instruction=" + truncateForLog(instruction, 60));
  if (!instruction) {
    logStepFailed(TOOL_BUILD_FULL, 1, 4, "missing instruction", "Use build_full with an instruction string.");
    return { ok: false, error: "build_full requires instruction" };
  }
  logStepOk(TOOL_BUILD_FULL, 1, 4);

  logStep(TOOL_BUILD_FULL, 2, 4, "resolve model and catalog");
  const resolved = await resolveModelAndCatalog(config, store);
  if (!resolved.ok) {
    logStepFailed(TOOL_BUILD_FULL, 2, 4, resolved.error, "Set BUILD_LLM_MODEL (and LLM_PROVIDER/API keys).");
    return { ok: false, error: resolved.error };
  }
  const { model, catalog, blockBounds } = resolved.ctx;
  logStepOk(TOOL_BUILD_FULL, 2, 4, "catalog entries=" + catalog.length);

  logStep(TOOL_BUILD_FULL, 3, 4, "call LLM (buildFull)");
  const result = await withThinking(client, () =>
    buildFull(model, instruction, catalogToJson(catalog), blockBounds)
  );
  if (!result.ok) {
    logStepFailed(TOOL_BUILD_FULL, 3, 4, result.error, "Check BUILD_LLM_MODEL, API key, and instruction.");
    return result;
  }
  logStepOk(TOOL_BUILD_FULL, 3, 4, "mml length=" + result.mml.length);
  if (result.usage && !config.skipCreditReport) {
    reportUsageToHub(config, store, result.usage, config.buildLlmModel);
  }

  logStep(TOOL_BUILD_FULL, 4, 4, "persist MML", args.documentTarget ?? "new", args.documentId ?? "");
  const buildResult = await persistFullBuildMml(client, store, result.mml, args);
  if (!buildResult.ok) {
    logStepFailed(TOOL_BUILD_FULL, 4, 4, buildResult.error, "Check documentId/target and engine connection.");
    return buildResult;
  }
  logStepOk(TOOL_BUILD_FULL, 4, 4, buildResult.summary?.slice(0, 100));
  return buildResult;
}

/**
 * build_incremental: validate → resolve target + load existing MML → resolve model+catalog → call LLM → persist fragment.
 */
export async function handleBuildIncremental(
  client: DoppelClient,
  store: ClawStore,
  config: ClawConfig,
  args: {
    instruction?: string;
    documentTarget?: string;
    documentId?: string;
    position?: string;
  }
): Promise<BuildToolResult> {
  const instruction = typeof args.instruction === "string" ? args.instruction.trim() : "";
  const state = store.getState();
  const blockDoc = state.documentsByBlockSlot[state.blockSlotId];

  logStep(TOOL_BUILD_INCREMENTAL, 1, 5, "validate", "instruction=" + truncateForLog(instruction, 50), "target=" + (args.documentTarget ?? "new"));
  if (!instruction) {
    logStepFailed(TOOL_BUILD_INCREMENTAL, 1, 5, "missing instruction", "Use build_incremental with an instruction string.");
    return { ok: false, error: "build_incremental requires instruction" };
  }
  const explicitId =
    typeof args.documentId === "string" && args.documentId.trim() ? args.documentId.trim() : null;
  if (explicitId && !isDocumentIdUuid(explicitId)) {
    logStepFailed(TOOL_BUILD_INCREMENTAL, 1, 5, "documentId must be a UUID from list_documents", DOCUMENT_ID_UUID_HINT);
    return { ok: false, error: `build_incremental: ${DOCUMENT_ID_UUID_HINT}` };
  }
  logStepOk(TOOL_BUILD_INCREMENTAL, 1, 5);

  logStep(TOOL_BUILD_INCREMENTAL, 2, 5, "resolve target and load existing");
  const targetRaw =
    typeof args.documentTarget === "string" ? args.documentTarget.trim().toLowerCase() : "";
  const appendByTarget = targetRaw === "append_current" || targetRaw === "append";
  const wantAppend =
    appendByTarget || (explicitId && blockDoc && explicitId === blockDoc.documentId);

  let appendTargetId: string | null = null;
  if (wantAppend) {
    if (appendByTarget && explicitId && isDocumentIdUuid(explicitId)) appendTargetId = explicitId;
    else if (appendByTarget && blockDoc) appendTargetId = blockDoc.documentId;
    else if (explicitId && blockDoc && explicitId === blockDoc.documentId)
      appendTargetId = blockDoc.documentId;
  }

  let existingMml = blockDoc?.mml ?? "";
  if (wantAppend && appendTargetId && (!blockDoc || appendTargetId !== blockDoc.documentId)) {
    try {
      const res = await client.getDocumentContent(appendTargetId);
      existingMml = res.content;
    } catch {
      logStepFailed(TOOL_BUILD_INCREMENTAL, 2, 5, "could not load document for append", "Call list_documents and use a valid documentId.");
      return {
        ok: false,
        error: `build_incremental: could not load document ${appendTargetId} for append—check list_documents`,
      };
    }
  }
  logStepOk(TOOL_BUILD_INCREMENTAL, 2, 5, wantAppend ? "append to " + appendTargetId : "new document", "existingMml=" + existingMml.length + " chars");

  logStep(TOOL_BUILD_INCREMENTAL, 3, 5, "resolve model and catalog");
  const resolved = await resolveModelAndCatalog(config, store);
  if (!resolved.ok) {
    logStepFailed(TOOL_BUILD_INCREMENTAL, 3, 5, resolved.error, "Set BUILD_LLM_MODEL.");
    return { ok: false, error: resolved.error };
  }
  const { model, catalog, blockBounds } = resolved.ctx;
  const positionHint = typeof args.position === "string" ? args.position.trim() : undefined;
  logStepOk(TOOL_BUILD_INCREMENTAL, 3, 5);

  logStep(TOOL_BUILD_INCREMENTAL, 4, 5, "call LLM (buildIncremental)");
  const result = await withThinking(client, () =>
    buildIncremental(model, instruction, existingMml, catalogToJson(catalog), blockBounds, positionHint)
  );
  if (!result.ok) {
    logStepFailed(TOOL_BUILD_INCREMENTAL, 4, 5, result.error, "Check BUILD_LLM_MODEL and instruction.");
    return result;
  }
  logStepOk(TOOL_BUILD_INCREMENTAL, 4, 5, "fragment length=" + result.mml.length);
  if (result.usage && !config.skipCreditReport) {
    reportUsageToHub(config, store, result.usage, config.buildLlmModel);
  }

  logStep(TOOL_BUILD_INCREMENTAL, 5, 5, "persist fragment");
  const fragment = result.mml;
  if (!wantAppend) {
    const { documentId: newId } = await client.createDocument(fragment);
    store.mergeDocumentsByBlockSlot(state.blockSlotId, { documentId: newId, mml: fragment });
    logStepOk(TOOL_BUILD_INCREMENTAL, 5, 5, "new document", newId);
    return { ok: true, summary: `built fragment as new document ${newId}` };
  }
  const idToAppend = appendTargetId ?? blockDoc?.documentId ?? null;
  if (!idToAppend) {
    const { documentId: newId } = await client.createDocument(fragment);
    store.mergeDocumentsByBlockSlot(state.blockSlotId, { documentId: newId, mml: fragment });
    logStepOk(TOOL_BUILD_INCREMENTAL, 5, 5, "new document", newId);
    return { ok: true, summary: `built fragment as new document ${newId}` };
  }
  const newMml = existingMml ? `${existingMml}\n${fragment}` : fragment;
  await client.appendDocument(idToAppend, fragment);
  store.mergeDocumentsByBlockSlot(state.blockSlotId, { documentId: idToAppend, mml: newMml });
  logStepOk(TOOL_BUILD_INCREMENTAL, 5, 5, "appended to", idToAppend);
  return { ok: true, summary: `appended to document ${idToAppend}` };
}

/**
 * build_with_code: validate → resolve block bounds → Gemini code execution (Python sandbox) → persist MML.
 * Requires LLM_PROVIDER=google and GOOGLE_API_KEY.
 */
export async function handleBuildWithCode(
  client: DoppelClient,
  store: ClawStore,
  config: ClawConfig,
  args: { instruction?: string; documentTarget?: string; documentId?: string }
): Promise<BuildToolResult> {
  const instruction = typeof args.instruction === "string" ? args.instruction.trim() : "";

  logStep(TOOL_BUILD_WITH_CODE, 1, 4, "validate", "instruction=" + truncateForLog(instruction, 60));
  if (!instruction) {
    logStepFailed(TOOL_BUILD_WITH_CODE, 1, 4, "missing instruction", "Use build_with_code with an instruction string.");
    return { ok: false, error: "build_with_code requires instruction" };
  }
  logStepOk(TOOL_BUILD_WITH_CODE, 1, 4);

  logStep(TOOL_BUILD_WITH_CODE, 2, 4, "resolve block bounds");
  const blockBounds = getBlockBounds(store.getState().blockSlotId);
  logStepOk(TOOL_BUILD_WITH_CODE, 2, 4, "blockSlotId=" + store.getState().blockSlotId);

  logStep(TOOL_BUILD_WITH_CODE, 3, 4, "call Gemini code execution (Python sandbox)");
  let result: Awaited<ReturnType<typeof buildFullWithCodeExecution>>;
  try {
    result = await withThinking(client, () =>
      buildFullWithCodeExecution(config, config.buildLlmModel, instruction, blockBounds)
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    logStepFailed(TOOL_BUILD_WITH_CODE, 3, 4, "code sandbox threw", "Check model supports codeExecution (e.g. gemini-2.0-flash-exp) and GOOGLE_API_KEY.");
    clawLog("build: build_with_code step 3/4 throw:", msg);
    if (stack) clawLog("build: build_with_code step 3/4 stack:", stack);
    return { ok: false, error: `build_with_code sandbox error: ${msg}` };
  }
  if (!result.ok) {
    logStepFailed(TOOL_BUILD_WITH_CODE, 3, 4, result.error, "Ensure LLM_PROVIDER=google and GOOGLE_API_KEY; or use build_full instead.");
    clawLog("build: build_with_code step 3/4 output (error):", result.error);
    return result;
  }
  logStepOk(TOOL_BUILD_WITH_CODE, 3, 4, "mml length=" + result.mml.length);
  const mmlPreview = result.mml.trim().slice(0, 600);
  clawLog("build: build_with_code step 3/4 output (mml preview):", mmlPreview + (result.mml.length > 600 ? "\n… (truncated)" : ""));
  if (result.usage && !config.skipCreditReport) {
    reportUsageToHub(config, store, result.usage, config.buildLlmModel);
  }

  logStep(TOOL_BUILD_WITH_CODE, 4, 4, "persist MML", args.documentTarget ?? "new", args.documentId ?? "");
  const buildResult = await persistFullBuildMml(client, store, result.mml, args);
  if (!buildResult.ok) {
    logStepFailed(TOOL_BUILD_WITH_CODE, 4, 4, buildResult.error, "Check documentId/target and engine connection.");
    return buildResult;
  }
  logStepOk(TOOL_BUILD_WITH_CODE, 4, 4, buildResult.summary?.slice(0, 100));
  return buildResult;
}
