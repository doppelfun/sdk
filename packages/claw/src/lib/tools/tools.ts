/**
 * Tool execution for Claw. Schemas live in toolsZod.ts; AI SDK calls via toolsAi → executeTool.
 */

import type { DoppelClient } from "@doppelfun/sdk";
import { getBlockCatalog, getEngineCatalog, type CatalogEntry as SdkCatalogEntry } from "@doppelfun/sdk";
import { runProceduralMml } from "@doppelfun/gen";
import type { Usage } from "../llm/usage.js";
import type { ClawState } from "../state/state.js";
import { syncMainDocumentForBlock } from "../state/state.js";
import type { ClawConfig } from "../config/config.js";
import { getBlockBounds } from "../../util/blockBounds.js";
import { buildFull, buildIncremental } from "../llm/buildLlm.js";
import { createLlmProvider } from "../llm/provider.js";
import { checkBalance, reportUsage as hubReportUsage } from "../hub/hub.js";
import { clawLog, clawDebug } from "../log.js";

/** Build-tool catalog slice for build LLM prompt (id, name, url, category). */
export type CatalogEntry = { id: string; name?: string; url?: string; category?: string };

function mapSdkCatalog(list: SdkCatalogEntry[]): CatalogEntry[] {
  return list
    .map((e: SdkCatalogEntry) => ({
      id: e.id || e.tag || "",
      name: e.name,
      url: e.url,
      category: e.category,
    }))
    .filter((e) => e.id);
}

/**
 * Fetch DB-backed catalog for list_catalog / build prompts.
 * blockId set → hub GET /api/blocks/:id/catalog; else → engine GET /api/catalog (hub cache).
 */
async function loadCatalogEntries(config: ClawConfig): Promise<CatalogEntry[]> {
  if (config.blockId) {
    const list = await getBlockCatalog(config.hubUrl, config.blockId, config.apiKey);
    return mapSdkCatalog(list);
  }
  const list = await getEngineCatalog(config.engineUrl);
  return mapSdkCatalog(list);
}

/**
 * Resolve catalog for builds: same source as loadCatalogEntries but returns [] on failure
 * so build can still run with empty catalog hint.
 */
async function getCatalogForBuild(config: ClawConfig): Promise<CatalogEntry[]> {
  try {
    return await loadCatalogEntries(config);
  } catch {
    return [];
  }
}

/** Serialize up to 100 entries for build LLM context (keeps prompt size bounded). */
function catalogToJson(catalog: CatalogEntry[]): string {
  return JSON.stringify(catalog.slice(0, 100), null, 0);
}

/**
 * Owner gate: if hosted + ownerUserId is set, only the owner can trigger builds/deletes.
 * Returns null when allowed; otherwise an error string for ExecuteToolResult.
 */
function checkOwnerGate(config: ClawConfig, state: ClawState): string | null {
  if (!config.hosted) return null;
  if (!config.ownerUserId) return null;
  if (state.lastTriggerUserId === config.ownerUserId) return null;
  return "Only the owner can trigger builds";
}

/** DRY early-return for any tool that uses checkOwnerGate. */
function ownerGateDenied(
  config: ClawConfig,
  state: ClawState
): { ok: false; error: string } | null {
  const err = checkOwnerGate(config, state);
  return err ? { ok: false, error: err } : null;
}

// --- Document list cache (list_documents + delete*) ---

/** Max chars stored in state.lastDocumentsList so later ticks can answer without re-listing. */
const DOC_LIST_CACHE_MAX_CHARS = 6000;
/** Max chars returned to the model for list_documents in one tool result (keeps response bounded). */
const DOC_LIST_TOOL_RETURN_MAX_CHARS = 4000;

/**
 * Persist list_documents result into state; truncates with "re-call" hint if huge.
 * Tool return string may be further truncated for the LLM payload.
 */
function cacheDocumentsList(state: ClawState, ids: string[]): { summaryForTool: string } {
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

/** Cached list is invalid after any delete — avoids answering with stale ids. */
function invalidateDocumentListCache(state: ClawState): void {
  state.lastDocumentsList = null;
}

/**
 * When the tracked document for this block slot is deleted, drop slot state so
 * replace/append tools don't target a gone id.
 */
function clearTrackedDocumentIfDeleted(state: ClawState, deletedId: string): void {
  const blockDoc = state.documentsByBlockSlot[state.blockSlotId];
  if (blockDoc?.documentId === deletedId) {
    delete state.documentsByBlockSlot[state.blockSlotId];
    syncMainDocumentForBlock(state);
  }
}

/**
 * Pre-check balance for hosted agents. Hub balance is USD on the ledger.
 * Blocks when linked and balance is zero or negative (report-usage would fail deduct).
 * Set ALLOW_BUILD_WITHOUT_CREDITS=1 to skip this and skip report-usage for local dev (no ledger deduction).
 */
async function preCheckBalance(config: ClawConfig): Promise<string | null> {
  if (!config.hosted) return null;
  if (config.allowBuildWithoutCredits) return null;
  const res = await checkBalance(config.hubUrl, config.apiKey);
  if (!res.ok) return `Balance check failed: ${res.error}`;
  if (!res.linked) return null; // Agent not linked — no ledger
  if (res.balance <= 0) {
    return (
      `Insufficient credits (balance ${res.balance}). ` +
      `Add credits on the hub, or set ALLOW_BUILD_WITHOUT_CREDITS=1 for local dev only.`
    );
  }
  return null;
}

/**
 * Report build LLM usage to hub (POST /api/agents/me/report-usage).
 * OpenRouter: hub prices by model id. Google: provider.usageCostUsdBeforeMarkup + buildCreditMultiplier.
 * buildCreditMultiplier: scales reported completion tokens so hub charge reflects build surcharge.
 */
function reportBuildUsage(config: ClawConfig, usage: Usage | null): void {
  if (config.allowBuildWithoutCredits) return;
  if (!config.hosted || !usage || usage.total_tokens === 0) return;
  const promptTokens = Math.max(0, Math.floor(usage.prompt_tokens));
  let completionTokens = Math.max(0, Math.floor(usage.completion_tokens));
  const m = config.buildCreditMultiplier;
  if (m !== 1 && Number.isFinite(m) && m > 0) {
    completionTokens = Math.max(0, Math.floor(completionTokens * m));
  }
  if (promptTokens === 0 && completionTokens === 0) return;
  const provider = createLlmProvider(config);
  const usageForCost: Usage = {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  };
  const costUsd = provider.usageCostUsdBeforeMarkup(usageForCost, config.buildLlmModel);
  hubReportUsage(config.hubUrl, config.apiKey, {
    promptTokens,
    completionTokens,
    ...(costUsd != null
      ? { costUsd, model: config.buildLlmModel }
      : { model: config.buildLlmModel }),
  }).catch(() => {});
}

/** Parse "x,y,z" or "x,z" position hint from build_incremental into { x, y, z }. Returns null if invalid. */
function parsePositionHint(hint: string): { x: number; y: number; z: number } | null {
  const parts = hint.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const x = Number(parts[0]);
  const z = Number(parts[parts.length - 1]);
  const y = parts.length >= 3 ? Number(parts[1]) : 0;
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(y)) return null;
  return { x, y, z };
}

// --- Tool execution ---

/** Tool invocation: name + validated args (Zod-validated in toolsAi before calling). */
export type ToolInvocation = { name: string; args: Record<string, unknown> };

export type ExecuteToolResult = { ok: true; summary?: string } | { ok: false; error: string };

/**
 * Execute one tool by name with structured args. Mutates state (occupants, chat, documents, etc.).
 */
export async function executeTool(
  client: DoppelClient,
  state: ClawState,
  config: ClawConfig,
  tool: ToolInvocation
): Promise<ExecuteToolResult> {
  const args = tool.args && typeof tool.args === "object" && !Array.isArray(tool.args) ? tool.args : {};
  const argKeys = Object.keys(args);
  clawLog("tool", tool.name, argKeys.length ? "args=" + argKeys.join(",") : "args=(none)");
  clawDebug("tool args payload:", JSON.stringify(args).slice(0, 500));

  switch (tool.name) {
    // --- Movement & chat ---
    case "move": {
      const rawX = typeof args.moveX === "number" ? args.moveX : 0;
      const rawZ = typeof args.moveZ === "number" ? args.moveZ : 0;
      const MAX_MOVE = 0.4;
      const sprint = args.sprint === true;
      const jump = args.jump === true;

      // NPC-style continuous approach: set movementTarget and let movementDriverTick stream input
      const approachSessionId =
        typeof args.approachSessionId === "string" ? args.approachSessionId.trim() : "";
      const approachPosition =
        typeof args.approachPosition === "string" ? args.approachPosition.trim() : "";
      if (approachSessionId) {
        const occ = state.occupants.find((o) => o.clientId === approachSessionId);
        if (!occ?.position) {
          return {
            ok: false,
            error:
              "approachSessionId requires occupant with position—call get_occupants first and use clientId from context.",
          };
        }
        state.movementTarget = { x: occ.position.x, z: occ.position.z };
        state.movementSprint = sprint;
        client.sendInput({ moveX: 0, moveZ: 0, sprint: false, jump: false });
        return {
          ok: true,
          summary: `approach ${occ.username} at (${occ.position.x.toFixed(1)}, ${occ.position.z.toFixed(1)}) — auto-walk until close`,
        };
      }
      if (approachPosition) {
        const parsed = parsePositionHint(approachPosition);
        if (!parsed) {
          return { ok: false, error: "approachPosition must be like \"x,z\" or \"x,y,z\" (world coords)" };
        }
        state.movementTarget = { x: parsed.x, z: parsed.z };
        state.lastBuildTarget = { x: parsed.x, z: parsed.z };
        state.movementSprint = sprint;
        client.sendInput({ moveX: 0, moveZ: 0, sprint: false, jump: false });
        return {
          ok: true,
          summary: `approach (${parsed.x.toFixed(1)}, ${parsed.z.toFixed(1)}) — auto-walk until within ~2 m`,
        };
      }

      // Explicit stop clears auto-approach
      if (rawX === 0 && rawZ === 0) {
        state.movementTarget = null;
        state.movementSprint = false;
      }

      const moveX = Math.max(-MAX_MOVE, Math.min(MAX_MOVE, rawX));
      const moveZ = Math.max(-MAX_MOVE, Math.min(MAX_MOVE, rawZ));
      client.sendInput({ moveX, moveZ, sprint, jump });
      return { ok: true, summary: `move ${moveX},${moveZ}` };
    }
    case "chat": {
      const text = typeof args.text === "string" ? args.text.slice(0, 500).trim() : "";
      let targetSessionId =
        typeof args.targetSessionId === "string" ? args.targetSessionId.trim() || undefined : undefined;
      // If replying after inbound DM and model omitted targetSessionId, keep thread
      if (text && !targetSessionId && state.lastDmPeerSessionId) {
        targetSessionId = state.lastDmPeerSessionId;
      }
      if (text) {
        client.sendChat(text, targetSessionId ? { targetSessionId } : undefined);
        state.lastAgentChatMessage = text;
        state.lastTickSentChat = true;
        if (targetSessionId) state.lastDmPeerSessionId = targetSessionId;
        else state.lastDmPeerSessionId = null;
      }
      return { ok: true, summary: targetSessionId ? "sent DM" : "sent chat" };
    }
    case "emote": {
      const emoteId = typeof args.emoteId === "string" ? args.emoteId.trim() : "";
      if (emoteId) client.sendEmote(emoteId);
      return { ok: true, summary: emoteId ? `emote ${emoteId}` : "emote (no id)" };
    }
    case "join_block": {
      const blockSlotId = typeof args.blockSlotId === "string" ? args.blockSlotId : "";
      if (blockSlotId) {
        // Engine WS join message still uses key regionId; same slot id string.
        client.sendJoin(blockSlotId);
        state.blockSlotId = blockSlotId;
        state.lastError = null;
        state.myPosition = null;
        state.lastBuildTarget = null;
        state.movementTarget = null;
        state.lastToolRun = null;
        state.lastDmPeerSessionId = null;
        state.lastCatalogContext = null;
        state.lastDocumentsList = null;
        state.lastOccupantsSummary = null;
        syncMainDocumentForBlock(state);
      }
      return { ok: true, summary: `join block ${blockSlotId}` };
    }
    // --- Context fetch ---
    case "get_occupants": {
      const occupants = await client.getOccupants();
      state.occupants = occupants;
      const self = state.mySessionId
        ? occupants.find((o) => o.clientId === state.mySessionId && o.position)
        : null;
      state.myPosition = self?.position ?? null;
      const summary = `${occupants.length} occupants`;
      state.lastOccupantsSummary = summary;
      return { ok: true, summary };
    }
    case "get_chat_history": {
      const limit = typeof args.limit === "number" ? Math.min(100, args.limit) : config.maxChatContext;
      const channelId =
        typeof args.channelId === "string" && args.channelId.trim() ? args.channelId.trim() : undefined;
      const { messages } = await client.getChatHistory({
        limit,
        ...(channelId ? { channelId } : {}),
      });
      state.chat = messages.map((m) => ({
        username: m.username,
        message: m.message,
        createdAt: m.createdAt,
        channelId: typeof m.channelId === "string" ? m.channelId : undefined,
        // History API may not include sessionId; WS pushes do—DM reply still uses lastDmPeerSessionId from WS
      }));
      return { ok: true, summary: `${messages.length} messages${channelId ? ` (channel ${channelId.slice(0, 24)}…)` : ""}` };
    }
    case "list_catalog": {
      let catalog: CatalogEntry[];
      try {
        catalog = await loadCatalogEntries(config);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: `list_catalog failed: ${msg}` };
      }
      const limit =
        typeof args.limit === "number" && args.limit > 0
          ? Math.min(200, Math.floor(args.limit))
          : 100;
      const slice = catalog.slice(0, limit);
      const source = config.blockId ? `hub block ${config.blockId}` : `engine ${config.engineUrl}`;
      const json = JSON.stringify(slice, null, 0);
      const prefix = `${catalog.length} catalog entries (${source}); showing ${slice.length}. Use catalog id in build MML <m-model catalogId="..."> when available. JSON: `;
      const maxSummary = 8000; // cap tool return size; compact cache used on later ticks
      let body = json;
      if (prefix.length + body.length > maxSummary) {
        body = body.slice(0, Math.max(0, maxSummary - prefix.length - 30)) + "… (truncated)";
      }
      const summary = prefix + body;
      // Persist compact snapshot only — full JSON was returned above for this turn; next ticks get a
      // bounded hint so the user message does not balloon (call list_catalog again if you need full JSON).
      const COMPACT_MAX_CHARS = 2800;
      const COMPACT_MAX_ENTRIES = 35;
      const compactEntries = slice.slice(0, COMPACT_MAX_ENTRIES).map((e) => ({
        id: e.id,
        ...(e.name ? { name: e.name } : {}),
        ...(e.category ? { category: e.category } : {}),
      }));
      let compact =
        `${catalog.length} catalog entries (${source}); showing ${compactEntries.length} compact (call list_catalog again for full list). JSON: ` +
        JSON.stringify(compactEntries);
      if (slice.length > COMPACT_MAX_ENTRIES) {
        compact += ` … (+${slice.length - COMPACT_MAX_ENTRIES} more in slice; +${catalog.length - slice.length} not in slice)`;
      }
      if (compact.length > COMPACT_MAX_CHARS) {
        compact = compact.slice(0, COMPACT_MAX_CHARS) + "… (truncated)";
      }
      state.lastCatalogContext = compact;
      return { ok: true, summary };
    }
    // --- Build (MML) ---
    case "build_full": {
      const instruction = typeof args.instruction === "string" ? args.instruction.trim() : "";
      if (!instruction) return { ok: false, error: "build_full requires instruction" };
      const denied = ownerGateDenied(config, state);
      if (denied) return denied;
      const balErr = await preCheckBalance(config);
      if (balErr) return { ok: false, error: balErr };
      const catalog = await getCatalogForBuild(config);
      const blockBounds = getBlockBounds(state.blockSlotId);
      client.sendThinking(true);
      let result: Awaited<ReturnType<typeof buildFull>>;
      try {
        result = await buildFull(
          createLlmProvider(config),
          config.buildLlmModel,
          instruction,
          catalogToJson(catalog),
          blockBounds
        );
      } finally {
        client.sendThinking(false);
      }
      if (!result.ok) return result;
      reportBuildUsage(config, result.usage);
      const mml = result.mml;
      const explicitId = typeof args.documentId === "string" && args.documentId.trim() ? args.documentId.trim() : null;
      const targetRaw = typeof args.documentTarget === "string" ? args.documentTarget.trim().toLowerCase() : "";
      // Default is always a new document unless explicitly told to replace/update (or documentId set).
      const wantReplace =
        targetRaw === "replace_current" ||
        targetRaw === "replace" ||
        targetRaw === "update";

      if (explicitId) {
        await client.updateDocument(explicitId, mml);
        const blockDoc = state.documentsByBlockSlot[state.blockSlotId];
        if (blockDoc?.documentId === explicitId) {
          state.documentsByBlockSlot[state.blockSlotId] = { documentId: explicitId, mml };
        }
        syncMainDocumentForBlock(state);
        return { ok: true, summary: `built full scene (updated ${explicitId})` };
      }
      if (!wantReplace) {
        // Default (omit documentTarget) or any value other than replace/update: always createDocument
        const { documentId: newId } = await client.createDocument(mml);
        state.documentsByBlockSlot[state.blockSlotId] = { documentId: newId, mml };
        syncMainDocumentForBlock(state);
        return { ok: true, summary: `built full scene (new document ${newId})` };
      }
      // replace_current / replace / update only when explicitly requested
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
    case "build_incremental": {
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
          state.lastBuildTarget = { x: parsed.x, z: parsed.z };
          state.movementTarget = { x: parsed.x, z: parsed.z };
        }
      }
      const catalog = await getCatalogForBuild(config);
      const blockDoc = state.documentsByBlockSlot[state.blockSlotId];
      const explicitId = typeof args.documentId === "string" && args.documentId.trim() ? args.documentId.trim() : null;
      if (explicitId && blockDoc && explicitId !== blockDoc.documentId) {
        return {
          ok: false,
          error: "build_incremental documentId must match current tracked document; use list_documents then append_current only",
        };
      }
      const existingMml = blockDoc?.mml ?? "";
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
      const targetRaw = typeof args.documentTarget === "string" ? args.documentTarget.trim().toLowerCase() : "";
      // Default is new document; append only when explicitly append_current / append (or documentId matches current).
      const wantAppend =
        targetRaw === "append_current" ||
        targetRaw === "append" ||
        (explicitId && blockDoc && explicitId === blockDoc.documentId);

      if (!wantAppend) {
        const { documentId: newId } = await client.createDocument(fragment);
        state.documentsByBlockSlot[state.blockSlotId] = { documentId: newId, mml: fragment };
        syncMainDocumentForBlock(state);
        return { ok: true, summary: `built fragment as new document ${newId}` };
      }
      const newMml = existingMml ? `${existingMml}\n${fragment}` : fragment;
      if (blockDoc) {
        await client.appendDocument(blockDoc.documentId, fragment);
        state.documentsByBlockSlot[state.blockSlotId] = { documentId: blockDoc.documentId, mml: newMml };
      } else {
        const { documentId: newId } = await client.createDocument(fragment);
        state.documentsByBlockSlot[state.blockSlotId] = { documentId: newId, mml: fragment };
      }
      syncMainDocumentForBlock(state);
      return { ok: true, summary: "appended to current document" };
    }
    case "list_documents": {
      const ids = await client.listDocuments();
      const { summaryForTool } = cacheDocumentsList(state, ids);
      return { ok: true, summary: summaryForTool };
    }
    case "delete_document": {
      const denied = ownerGateDenied(config, state);
      if (denied) return denied;
      const explicitId = typeof args.documentId === "string" && args.documentId.trim() ? args.documentId.trim() : null;
      const targetRaw = typeof args.target === "string" ? args.target.trim().toLowerCase() : "";

      let idToDelete: string | null = explicitId;
      if (!idToDelete && targetRaw === "current") {
        idToDelete = state.documentsByBlockSlot[state.blockSlotId]?.documentId ?? null;
        if (!idToDelete) return { ok: false, error: "delete_document target current but no tracked document" };
      }
      if (!idToDelete && targetRaw === "last") {
        const ids = await client.listDocuments();
        if (ids.length === 0) return { ok: false, error: "delete_document target last but no documents" };
        idToDelete = ids[ids.length - 1]!;
      }
      if (!idToDelete) {
        return { ok: false, error: "delete_document requires documentId or target current|last" };
      }

      await client.deleteDocument(idToDelete);
      invalidateDocumentListCache(state);
      clearTrackedDocumentIfDeleted(state, idToDelete);
      return { ok: true, summary: `deleted document ${idToDelete}` };
    }
    case "delete_all_documents": {
      const denied = ownerGateDenied(config, state);
      if (denied) return denied;
      const ids = await client.listDocuments();
      if (ids.length === 0) {
        state.lastDocumentsList = "0 documents";
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
      // One clearTrackedDocumentIfDeleted is enough if tracked id was in the list
      if (trackedId && ids.includes(trackedId)) {
        clearTrackedDocumentIfDeleted(state, trackedId);
      }
      state.lastDocumentsList = deleted === ids.length ? "0 documents" : null;
      return {
        ok: true,
        summary: `deleted ${deleted}/${ids.length} document(s)`,
      };
    }
    // --- Procedural gen (single tool; no LLM; owner gate only) ---
    case "generate_procedural": {
      const denied = ownerGateDenied(config, state);
      if (denied) return denied;
      const kind = typeof args.kind === "string" ? args.kind.trim() : "";
      if (!kind) {
        return { ok: false, error: "generate_procedural requires kind (see @doppelfun/gen listProceduralKinds)" };
      }

      const modeRaw = typeof args.documentMode === "string" ? args.documentMode.trim().toLowerCase() : "";
      // Default is new document; replace/append only when explicitly set.
      const documentMode =
        modeRaw === "replace" || modeRaw === "replace_current" || modeRaw === "update"
          ? "replace"
          : modeRaw === "append" || modeRaw === "append_current"
            ? "append"
            : "new";

      let mml: string;
      try {
        mml = runProceduralMml(kind, args as Record<string, unknown>);
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "generate_procedural failed" };
      }

      const applyMml = async (mmlInner: string, baseSummary: string) => {
        const blockDoc = state.documentsByBlockSlot[state.blockSlotId];

        if (documentMode === "new") {
          const { documentId: newId } = await client.createDocument(mmlInner);
          state.documentsByBlockSlot[state.blockSlotId] = { documentId: newId, mml: mmlInner };
          syncMainDocumentForBlock(state);
          return { ok: true as const, summary: `${baseSummary} (new document ${newId})` };
        }

        if (documentMode === "append") {
          if (blockDoc) {
            await client.appendDocument(blockDoc.documentId, mmlInner);
            const newMml = blockDoc.mml ? `${blockDoc.mml}\n${mmlInner}` : mmlInner;
            state.documentsByBlockSlot[state.blockSlotId] = { documentId: blockDoc.documentId, mml: newMml };
          } else {
            const { documentId: newId } = await client.createDocument(mmlInner);
            state.documentsByBlockSlot[state.blockSlotId] = { documentId: newId, mml: mmlInner };
          }
          syncMainDocumentForBlock(state);
          return { ok: true as const, summary: `${baseSummary} (appended)` };
        }

        // replace: update in place or create if none (explicit only; default is new above)
        if (blockDoc) {
          await client.updateDocument(blockDoc.documentId, mmlInner);
          state.documentsByBlockSlot[state.blockSlotId] = { documentId: blockDoc.documentId, mml: mmlInner };
        } else {
          const { documentId: newId } = await client.createDocument(mmlInner);
          state.documentsByBlockSlot[state.blockSlotId] = { documentId: newId, mml: mmlInner };
        }
        syncMainDocumentForBlock(state);
        return { ok: true as const, summary: `${baseSummary} (replaced)` };
      };

      const summaryLabel = `generated ${kind.trim().toLowerCase()} scene`;
      // applyMml async — must not reject or onToolCallResult never runs and chat can still run in same step
      try {
        return await applyMml(mml, summaryLabel);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        clawLog("tool generate_procedural failed", msg);
        return { ok: false, error: `generate_procedural: ${msg}` };
      }
    }
    default:
      return { ok: false, error: `Unknown tool: ${tool.name}` };
  }
}
