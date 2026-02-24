/**
 * Tool definitions (OpenRouter/OpenAI schema) and execution.
 * Each tool is a function the Chat LLM can call; executeTool runs it and updates state.
 */

import type { DoppelClient } from "@doppel-sdk/core";
import type { ToolDefinition } from "./openrouter.js";
import type { RuntimeState } from "./state.js";
import type { RuntimeConfig } from "./config.js";
import { buildFull, buildIncremental } from "./buildLlm.js";

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

// --- Tool definitions (OpenAI/OpenRouter function-calling schema) ---

/** Tool definitions for the Chat LLM. Must match executeTool switch cases. */
export const CHAT_TOOLS: ToolDefinition[] = [
  toolDef(
    "move",
    "Move the agent a small amount. Use moveX and moveZ between -0.4 and 0.4 (e.g. 0.2). Never use 1 or -1.",
    {
      type: "object",
      properties: {
        moveX: { type: "number", description: "Horizontal movement, small: -0.4 to 0.4" },
        moveZ: { type: "number", description: "Forward/back, small: -0.4 to 0.4" },
        sprint: { type: "boolean", description: "Sprint" },
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
  state: RuntimeState,
  config: RuntimeConfig,
  tool: ToolCallExecution
): Promise<ExecuteToolResult> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(tool.arguments) as Record<string, unknown>;
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
      }
      return { ok: true, summary: `join ${regionId}` };
    }
    // --- Context fetch ---
    case "get_occupants": {
      const occupants = await client.getOccupants();
      state.occupants = occupants;
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
      const documentId = typeof args.documentId === "string" ? args.documentId : null;
      const catalog = await getCatalogFromEngine(config.engineUrl);
      const result = await buildFull(
        config.openRouterApiKey,
        config.buildLlmModel,
        instruction,
        catalogToJson(catalog)
      );
      if (!result.ok) return result;
      state.mainDocumentMml = result.mml;
      if (documentId) {
        await client.updateDocument(documentId, result.mml);
        state.mainDocumentId = documentId;
      } else {
        const { documentId: newId } = await client.createDocument(result.mml);
        state.mainDocumentId = newId;
      }
      return { ok: true, summary: "built full scene" };
    }
    case "build_incremental": {
      const instruction = typeof args.instruction === "string" ? args.instruction.trim() : "";
      if (!instruction) return { ok: false, error: "build_incremental requires instruction" };
      let documentId = typeof args.documentId === "string" ? args.documentId : state.mainDocumentId;
      const position = typeof args.position === "string" ? args.position : undefined;
      const catalog = await getCatalogFromEngine(config.engineUrl);
      const existingMml = state.mainDocumentMml || "";
      const result = await buildIncremental(
        config.openRouterApiKey,
        config.buildLlmModel,
        instruction,
        existingMml,
        catalogToJson(catalog),
        position
      );
      if (!result.ok) return result;
      state.mainDocumentMml = existingMml ? `${existingMml}\n${result.mmlFragment}` : result.mmlFragment;
      if (!documentId) {
        const { documentId: newId } = await client.createDocument(result.mmlFragment);
        documentId = newId;
        state.mainDocumentId = newId;
      } else {
        await client.appendDocument(documentId, result.mmlFragment);
      }
      return { ok: true, summary: "appended to scene" };
    }
    case "list_documents": {
      const ids = await client.listDocuments();
      if (ids.length > 0 && !state.mainDocumentId) state.mainDocumentId = ids[0];
      return { ok: true, summary: `${ids.length} documents` };
    }
    default:
      return { ok: false, error: `Unknown tool: ${tool.name}` };
  }
}
