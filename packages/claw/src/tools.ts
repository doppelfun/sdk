/**
 * Tool definitions (OpenRouter/OpenAI schema) and execution.
 * Each tool is a function the Chat LLM can call; executeTool runs it and updates state.
 */

import type { DoppelClient } from "@doppelfun/sdk";
import type { ToolDefinition, Usage } from "./openrouter.js";
import type { ClawState } from "./state.js";
import { syncMainDocumentFromRegion } from "./state.js";
import type { ClawConfig } from "./config.js";
import { getRegionBounds } from "./region.js";
import { buildFull, buildIncremental } from "./buildLlm.js";
import { checkBalance, spendCredits } from "./hub.js";

/** Schema for tool parameters: object with optional properties and required list. */
type ToolParams = {
  type: "object";
  properties: Record<string, { type: string; description?: string }>;
  required?: string[];
};

/** Build a single function tool definition (DRY). */
function toolDef(
  name: string,
  description: string,
  parameters: ToolParams
): ToolDefinition {
  return { type: "function", function: { name, description, parameters } };
}

/** Catalog entry from GET /api/agent/catalog (used by build tools). */
export type CatalogEntry = { id: string; name?: string; glbUrl?: string; category?: string };

/** Fetch build catalog from engine; returns empty array on failure. */
async function getCatalogFromEngine(engineUrl: string): Promise<CatalogEntry[]> {
  const base = engineUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/api/agent/catalog`);
  if (!res.ok) return [];
  const data = (await res.json()) as { catalog?: CatalogEntry[] };
  return Array.isArray(data.catalog) ? data.catalog : [];
}

function catalogToJson(catalog: CatalogEntry[]): string {
  return JSON.stringify(catalog.slice(0, 100), null, 0);
}

/** Convert token usage to credit amount (mirrors agent.ts helper). */
function tokensToCredits(usage: Usage, tokensPerCredit: number): number {
  return usage.total_tokens / tokensPerCredit;
}

/** Owner gate: if hosted + ownerUserId is set, only owner can trigger builds. */
function checkOwnerGate(config: ClawConfig, state: ClawState): string | null {
  if (!config.hosted) return null;
  if (!config.ownerUserId) return null;
  if (state.lastTriggerUserId === config.ownerUserId) return null;
  return "Only the owner can trigger builds";
}

/** Pre-check balance for hosted agents. Returns error string or null. */
async function preCheckBalance(config: ClawConfig, minCredits: number): Promise<string | null> {
  if (!config.hosted) return null;
  const res = await checkBalance(config.hubUrl, config.apiKey);
  if (!res.ok) return `Balance check failed: ${res.error}`;
  if (!res.linked) return null; // Agent not linked to account — no credit system
  if (res.balance < minCredits) return `Insufficient credits (have ${res.balance}, need ~${minCredits})`;
  return null;
}

/** Report build usage to hub. Fire-and-forget; logs failures but never crashes. */
function reportBuildUsage(config: ClawConfig, usage: Usage | null, description: string): void {
  if (!config.hosted || !usage || usage.total_tokens === 0) return;
  const credits = tokensToCredits(usage, config.tokensPerCredit) * config.buildCreditMultiplier;
  if (credits <= 0) return;
  spendCredits(config.hubUrl, config.apiKey, credits, description).catch(() => {
    // logged as best-effort; tokens already consumed at OpenRouter
  });
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

// --- Tool definitions (OpenAI/OpenRouter function-calling schema) ---

/** Tool definitions for the Chat LLM. Must match executeTool switch cases. */
export const CHAT_TOOLS: ToolDefinition[] = [
  toolDef(
    "move",
    "Move toward a target (another user or build location). Use only when you have a target; use moveX/moveZ 0 when within ~2 m or when no target. Values between -0.4 and 0.4.",
    {
      type: "object",
      properties: {
        moveX: { type: "number", description: "Horizontal movement toward target, -0.4 to 0.4; 0 to stop" },
        moveZ: { type: "number", description: "Forward/back toward target, -0.4 to 0.4; 0 to stop" },
        sprint: { type: "boolean", description: "Sprint when moving toward target" },
        jump: { type: "boolean", description: "Jump" },
      },
      required: ["moveX", "moveZ"],
    }
  ),
  toolDef("chat", "Send a chat message to the space (visible to all).", {
    type: "object",
    properties: { text: { type: "string", description: "Message text (max 500 chars)" } },
    required: ["text"],
  }),
  toolDef("emote", "Play an emote animation. Pass a URL to a .glb animation file.", {
    type: "object",
    properties: { emoteFileUrl: { type: "string", description: "URL to emote .glb" } },
    required: ["emoteFileUrl"],
  }),
  toolDef("join_region", "Switch to another region (e.g. when you get region_boundary error).", {
    type: "object",
    properties: { regionId: { type: "string", description: "Target region id" } },
    required: ["regionId"],
  }),
  toolDef("get_occupants", "List everyone currently in the space (observers, users, agents).", {
    type: "object",
    properties: {},
  }),
  toolDef("get_chat_history", "Get recent chat messages in the space.", {
    type: "object",
    properties: { limit: { type: "number", description: "Max messages (default 20)" } },
  }),
  toolDef("build_full", "Create or replace a full scene with MML. Use for new worlds or full redesigns.", {
    type: "object",
    properties: {
      instruction: { type: "string", description: "What to build (e.g. a park with a fountain and three trees)" },
      documentId: { type: "string", description: "Optional; omit to create new document" },
    },
    required: ["instruction"],
  }),
  toolDef("build_incremental", "Add to the current world (e.g. add a bench at 2,0,4). Does not replace existing content.", {
    type: "object",
    properties: {
      instruction: { type: "string", description: "What to add and where (e.g. add a fountain at 5,0,5)" },
      documentId: { type: "string", description: "Optional; use main document if omitted" },
      position: { type: "string", description: "Optional position hint (e.g. 5,0,5)" },
    },
    required: ["instruction"],
  }),
  toolDef("list_documents", "List document ids owned by this agent.", {
    type: "object",
    properties: {},
  }),
];

/** One tool call from the LLM (name + JSON string arguments). */
export type ToolCallExecution = { name: string; arguments: string };

export type ExecuteToolResult = { ok: true; summary?: string } | { ok: false; error: string };

/**
 * Execute one tool call. Parses arguments as JSON, runs the matching handler, mutates state (e.g. occupants, chat, mainDocumentId).
 * Returns { ok, summary } on success or { ok: false, error } on failure.
 */
export async function executeTool(
  client: DoppelClient,
  state: ClawState,
  config: ClawConfig,
  tool: ToolCallExecution
): Promise<ExecuteToolResult> {
  let args: Record<string, unknown>;
  const rawArgs = typeof tool.arguments === "string" && tool.arguments.trim() ? tool.arguments : "{}";
  try {
    args = JSON.parse(rawArgs) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "Invalid tool arguments JSON" };
  }

  switch (tool.name) {
    // --- Movement & chat ---
    case "move": {
      const rawX = typeof args.moveX === "number" ? args.moveX : 0;
      const rawZ = typeof args.moveZ === "number" ? args.moveZ : 0;
      const MAX_MOVE = 0.4;
      const moveX = Math.max(-MAX_MOVE, Math.min(MAX_MOVE, rawX));
      const moveZ = Math.max(-MAX_MOVE, Math.min(MAX_MOVE, rawZ));
      const sprint = args.sprint === true;
      const jump = args.jump === true;
      client.sendInput({ moveX, moveZ, sprint, jump });
      return { ok: true, summary: `move ${moveX},${moveZ}` };
    }
    case "chat": {
      const text = typeof args.text === "string" ? args.text.slice(0, 500).trim() : "";
      if (text) {
        client.sendChat(text);
        state.lastAgentChatMessage = text;
      }
      return { ok: true, summary: "sent chat" };
    }
    case "emote": {
      const url = typeof args.emoteFileUrl === "string" ? args.emoteFileUrl.trim() : "";
      if (url) client.sendEmote(url);
      return { ok: true, summary: "emote" };
    }
    case "join_region": {
      const regionId = typeof args.regionId === "string" ? args.regionId : "";
      if (regionId) {
        client.sendJoin(regionId);
        state.regionId = regionId;
        state.lastError = null;
        state.myPosition = null;
        state.lastBuildTarget = null;
        state.lastToolRun = null;
        syncMainDocumentFromRegion(state);
      }
      return { ok: true, summary: `join ${regionId}` };
    }
    // --- Context fetch ---
    case "get_occupants": {
      const occupants = await client.getOccupants();
      state.occupants = occupants;
      const self = state.mySessionId
        ? occupants.find((o) => o.clientId === state.mySessionId && o.position)
        : null;
      state.myPosition = self?.position ?? null;
      return { ok: true, summary: `${occupants.length} occupants` };
    }
    case "get_chat_history": {
      const limit = typeof args.limit === "number" ? Math.min(100, args.limit) : config.maxChatContext;
      const { messages } = await client.getChatHistory({ limit });
      state.chat = messages.map((m) => ({
        username: m.username,
        message: m.message,
        createdAt: m.createdAt,
      }));
      return { ok: true, summary: `${messages.length} messages` };
    }
    // --- Build (MML) ---
    case "build_full": {
      const instruction = typeof args.instruction === "string" ? args.instruction.trim() : "";
      if (!instruction) return { ok: false, error: "build_full requires instruction" };
      // Owner gate (hosted agents only)
      const ownerErr = checkOwnerGate(config, state);
      if (ownerErr) return { ok: false, error: ownerErr };
      // Pre-check balance (hosted agents only; estimate ~8 base credits × build multiplier)
      const balErr = await preCheckBalance(config, 8 * config.buildCreditMultiplier);
      if (balErr) return { ok: false, error: balErr };
      const catalog = await getCatalogFromEngine(config.engineUrl);
      const regionBounds = getRegionBounds(state.regionId);
      const result = await buildFull(
        config.openRouterApiKey,
        config.buildLlmModel,
        instruction,
        catalogToJson(catalog),
        regionBounds
      );
      if (!result.ok) return result;
      reportBuildUsage(config, result.usage, `build_full: ${instruction.slice(0, 80)}`);
      const regionDoc = state.documentsByRegion[state.regionId];
      if (regionDoc) {
        await client.updateDocument(regionDoc.documentId, result.mml);
        state.documentsByRegion[state.regionId] = { documentId: regionDoc.documentId, mml: result.mml };
      } else {
        const { documentId: newId } = await client.createDocument(result.mml);
        state.documentsByRegion[state.regionId] = { documentId: newId, mml: result.mml };
      }
      syncMainDocumentFromRegion(state);
      return { ok: true, summary: "built full scene" };
    }
    case "build_incremental": {
      const instruction = typeof args.instruction === "string" ? args.instruction.trim() : "";
      if (!instruction) return { ok: false, error: "build_incremental requires instruction" };
      // Owner gate (hosted agents only)
      const ownerErr = checkOwnerGate(config, state);
      if (ownerErr) return { ok: false, error: ownerErr };
      // Pre-check balance (hosted agents only; estimate ~4 base credits × build multiplier)
      const balErr = await preCheckBalance(config, 4 * config.buildCreditMultiplier);
      if (balErr) return { ok: false, error: balErr };
      const positionHint = typeof args.position === "string" ? args.position.trim() : undefined;
      if (positionHint) {
        const parsed = parsePositionHint(positionHint);
        if (parsed) state.lastBuildTarget = { x: parsed.x, z: parsed.z };
      }
      const catalog = await getCatalogFromEngine(config.engineUrl);
      const regionDoc = state.documentsByRegion[state.regionId];
      const existingMml = regionDoc?.mml ?? "";
      const regionBounds = getRegionBounds(state.regionId);
      const result = await buildIncremental(
        config.openRouterApiKey,
        config.buildLlmModel,
        instruction,
        existingMml,
        catalogToJson(catalog),
        regionBounds,
        positionHint
      );
      if (!result.ok) return result;
      reportBuildUsage(config, result.usage, `build_incremental: ${instruction.slice(0, 80)}`);
      const newMml = existingMml ? `${existingMml}\n${result.mmlFragment}` : result.mmlFragment;
      if (regionDoc) {
        await client.appendDocument(regionDoc.documentId, result.mmlFragment);
        state.documentsByRegion[state.regionId] = { documentId: regionDoc.documentId, mml: newMml };
      } else {
        const { documentId: newId } = await client.createDocument(result.mmlFragment);
        state.documentsByRegion[state.regionId] = { documentId: newId, mml: result.mmlFragment };
      }
      syncMainDocumentFromRegion(state);
      return { ok: true, summary: "appended to scene" };
    }
    case "list_documents": {
      const ids = await client.listDocuments();
      return { ok: true, summary: `${ids.length} documents` };
    }
    default:
      return { ok: false, error: `Unknown tool: ${tool.name}` };
  }
}
