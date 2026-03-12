/**
 * Claw tool input schemas for Vercel AI SDK (Zod).
 * Input schemas for Vercel AI SDK (zodSchema + dynamicTool); executeTool receives validated args objects.
 */

// Align with AI SDK (ai package uses zod/v4 for tool schemas)
import { z } from "zod/v4";

export const moveSchema = z.object({
  moveX: z
    .number()
    .describe(
      "Horizontal component, -0.4 to 0.4. Use 0,0 to stop. Prefer approachSessionId or approachPosition for smooth NPC-style walk—the driver streams input every 50ms until arrival."
    ),
  moveZ: z
    .number()
    .describe("Forward/back component, -0.4 to 0.4; 0 to stop auto-approach"),
  sprint: z.boolean().optional().describe("Sprint when auto-approaching via target"),
  jump: z.boolean().optional().describe("Jump"),
  approachSessionId: z
    .string()
    .optional()
    .describe(
      "Optional. Occupant clientId to walk toward; sets continuous movement until within ~2 m (like NPCs). Requires get_occupants first so position is known."
    ),
  approachPosition: z
    .string()
    .optional()
    .describe('Optional. World target "x,z" or "x,y,z" to walk toward until close; same as build position hint format.'),
});

export const chatSchema = z.object({
  text: z.string().describe("Message text (max 500 chars)"),
  targetSessionId: z
    .string()
    .optional()
    .describe(
      "Recipient session id for DM only. Omit for global. When context shows a DM line, use the given targetSessionId so the reply stays in the same thread."
    ),
});

/** Emote ids match engine catalog: wave, heart, thumbs, clap, dance, shocked */
export const emoteSchema = z.object({
  emoteId: z
    .string()
    .describe(
      "Emote catalog id (not a URL). Examples: wave, heart, thumbs, clap, dance, shocked"
    ),
});

export const joinBlockSchema = z.object({
  blockSlotId: z
    .string()
    .describe('Target block slot id (e.g. "0_0", "1_0")'),
});

export const getOccupantsSchema = z.object({});

export const getChatHistorySchema = z.object({
  limit: z.number().optional().describe("Max messages (default 20)"),
  channelId: z
    .string()
    .optional()
    .describe('Optional. "global" or dm thread id from context—filters to that channel only.'),
});

export const buildFullSchema = z.object({
  instruction: z.string().describe("What to build"),
  documentTarget: z
    .string()
    .optional()
    .describe(
      'Optional. Default = always create a new document. Use "replace_current", "replace", or "update" only when explicitly updating the tracked doc in place. documentId alone also updates that id.'
    ),
  documentId: z
    .string()
    .optional()
    .describe(
      "Optional. When set, update this document id in place (replaces its content). Overrides documentTarget except new still creates if you want a second doc—prefer documentTarget new without documentId."
    ),
});

export const buildIncrementalSchema = z.object({
  instruction: z.string().describe("What to add and where"),
  documentTarget: z
    .string()
    .optional()
    .describe(
      'Optional. Default = create a new document with the fragment only. Use "append_current" or "append" only when explicitly appending to the tracked doc.'
    ),
  documentId: z
    .string()
    .optional()
    .describe(
      "Optional. Append to this id only if it is the current region document (same as append_current)."
    ),
  position: z.string().optional().describe("Optional position hint (e.g. 5,0,5)"),
});

export const listCatalogSchema = z.object({
  limit: z
    .number()
    .optional()
    .describe("Max entries to include in summary JSON (default 100, max 200)."),
});

export const listDocumentsSchema = z.object({});

export const deleteDocumentSchema = z.object({
  target: z
    .string()
    .optional()
    .describe('Optional. "current" = tracked active doc. "last" = last id from list_documents.'),
  documentId: z.string().optional().describe("Optional. Delete this id explicitly."),
});

export const deleteAllDocumentsSchema = z.object({});

/** LLM often emits hyphenated kinds; normalize before gen dispatch. */
const PROCEDURAL_KIND_ALIASES: Record<string, "city" | "pyramid"> = {
  "procedural-city": "city",
  procedural_city: "city",
  citygrid: "city",
  "procedural-pyramid": "pyramid",
  procedural_pyramid: "pyramid",
};

/**
 * kind + documentMode + params only. Procedurals read params via raw.params in gen.
 * Register new kinds in @doppelfun/gen PROCEDURAL_REGISTRY (CONTRIBUTING.md).
 * kind is enum after alias normalize so bad values fail at Zod parse (clear tool error) not at runtime.
 */
export const generateProceduralSchema = z.object({
  kind: z
    .string()
    .transform((s) => {
      const k = s.trim().toLowerCase();
      return PROCEDURAL_KIND_ALIASES[k] ?? k;
    })
    .pipe(z.enum(["city", "pyramid"]))
    .describe('Use "city" (grid + buildings) or "pyramid". Synonyms like procedural-city are normalized.'),
  documentMode: z
    .string()
    .optional()
    .describe('Optional. Default = "new" (create document). Use "replace" or "append" only when explicitly updating or appending.'),
  params: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Params for the procedural; shape is per-kind in gen (pyramid/city keys live here)."),
});

/** Lookup schema by tool name (for execute-time validation). */
export function getToolSchema(name: string): z.ZodTypeAny | undefined {
  return CLAW_TOOL_REGISTRY.find((t) => t.name === name)?.schema;
}

/** Registry: name → description + schema (single source for AI SDK tools). */
export const CLAW_TOOL_REGISTRY: Array<{
  name: string;
  description: string;
  schema: z.ZodTypeAny;
}> = [
  {
    name: "move",
    description:
      "Move toward a target. Prefer approachSessionId (occupant clientId after get_occupants) or approachPosition \"x,z\" for NPC-style auto-walk until close—input is streamed every 50ms like block NPCs. Or use moveX/moveZ -0.4..0.4 for one-shot input; 0,0 stops and clears auto-approach.",
    schema: moveSchema,
  },
  {
    name: "chat",
    description:
      "Send chat. Global: omit targetSessionId (whole room sees it). DM: set targetSessionId to the other participant's session id so only you two see it—required when replying to a DM (context will show targetSessionId to use).",
    schema: chatSchema,
  },
  {
    name: "emote",
    description:
      "Play an emote by id (wave, heart, thumbs, clap, dance, shocked). Use catalog ids only—not URLs.",
    schema: emoteSchema,
  },
  {
    name: "join_block",
    description:
      "Switch to another block slot (e.g. when you get a boundary error with a slot id). Engine join payload uses the same id string.",
    schema: joinBlockSchema,
  },
  {
    name: "get_occupants",
    description: "List everyone currently in the block (observers, users, agents).",
    schema: getOccupantsSchema,
  },
  {
    name: "get_chat_history",
    description:
      "Get recent chat. Omit channelId for global room chat only. Set channelId to a DM thread id (e.g. dm:sessionA:sessionB) to load that private thread—use when continuing a DM.",
    schema: getChatHistorySchema,
  },
  {
    name: "list_catalog",
    description:
      "List blocks catalog entries (id, name, url, category) from the hub block catalog or engine catalog—same source build_full uses. Call before building to pick catalogId for MML. Read-only; no credits.",
    schema: listCatalogSchema,
  },
  {
    name: "build_full",
    description:
      "Create a full scene with MML. Default = always create a new document (omit documentTarget). Use documentTarget replace_current/replace/update only when explicitly replacing the tracked doc; documentId updates that id in place.",
    schema: buildFullSchema,
  },
  {
    name: "build_incremental",
    description:
      "Add MML as a fragment. Default = new document with fragment only. Use documentTarget append_current/append only when explicitly appending to the tracked doc.",
    schema: buildIncrementalSchema,
  },
  {
    name: "list_documents",
    description:
      "List document ids owned by this agent. Summary includes ids so you can pass documentId to build_full or delete_document.",
    schema: listDocumentsSchema,
  },
  {
    name: "delete_document",
    description:
      'Delete one agent-owned document. target: current = tracked doc; last = last id from list_documents; or pass documentId. To delete every document in one go, use delete_all_documents instead of calling delete_document many times.',
    schema: deleteDocumentSchema,
  },
  {
    name: "delete_all_documents",
    description:
      "Delete every agent-owned document in the current block in one call. Use when the user asks to clear/remove/delete all documents or reset the block's agent documents. Owner gate applies when hosted.",
    schema: deleteAllDocumentsSchema,
  },
  {
    name: "generate_procedural",
    description:
      'Deterministic procedural MML (no LLM). Call this in the same turn when you tell the user you are building a city/pyramid—do not only chat. kind: city or pyramid. Params: city uses rows/cols, blockSize, streetWidth, setback, seed; pyramid uses baseWidth, layers, blockSize, etc. documentMode defaults to new; use replace or append only when explicitly told. Owner gate applies.',
    schema: generateProceduralSchema,
  },
];
