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
      "Horizontal component, -0.4 to 0.4. Use 0,0 to stop. Non-zero values are held and sent every 50ms like NPCs until 0,0. Prefer approachSessionId or approachPosition to walk to a world target until close."
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
      "Optional. Occupant clientId or userId to walk toward; sets continuous movement until within ~2 m (like NPCs). If not in cache, occupants are refreshed automatically."
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

/** API document ids are UUIDs only — reject filenames so Zod fails before executeTool. */
const DOCUMENT_ID_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const documentIdUuidOptional = z
  .string()
  .optional()
  .refine(
    (s) =>
      s === undefined ||
      String(s).trim() === "" ||
      DOCUMENT_ID_UUID_RE.test(String(s).trim()),
    {
      message:
        "documentId must be a UUID from list_documents only—not a filename. Omit documentId to create a new document; use documentTarget replace_current to update the tracked doc.",
    }
  );

export const buildFullSchema = z.object({
  instruction: z.string().describe("What to build"),
  documentTarget: z
    .string()
    .optional()
    .describe(
      'Optional. Default = new document (documentId ignored). Use "replace_current"/"replace"/"update" to update in place; with documentId (UUID from list_documents) updates that id; without documentId replaces the tracked doc only.'
    ),
  documentId: documentIdUuidOptional.describe(
    "Optional. UUID from list_documents. Ignored when creating new. With replace/update, updates that document in place. Never a filename."
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
  documentId: documentIdUuidOptional.describe(
    "Optional. UUID from list_documents. With append/append_current, appends to that id (or tracked doc if omitted). Never a filename."
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

export const getWorldEntitiesSchema = z.object({
  limit: z
    .number()
    .optional()
    .describe("Max entities to return (default 80). Use to avoid huge lists."),
});

export const moveToEntitySchema = z.object({
  entityId: z
    .string()
    .min(1)
    .describe(
      "Entity id from get_world_entities (e.g. pyr-0, doc:uuid:entity-id). Agent will pathfind to the entity center."
    ),
});

export const getDocumentContentSchema = z.object({
  documentId: documentIdUuidOptional.describe("UUID from list_documents only; omit with target current to read tracked doc."),
  target: z
    .string()
    .optional()
    .describe('Optional. "current" = tracked doc for this block slot; "last" = last id from list_documents.'),
});

export const deleteDocumentSchema = z.object({
  target: z
    .string()
    .optional()
    .describe('Optional. "current" = tracked active doc. "last" = last id from list_documents.'),
  documentId: documentIdUuidOptional.describe("Optional. UUID only—delete this id explicitly."),
});

export const deleteAllDocumentsSchema = z.object({});

/** LLM often emits hyphenated kinds; normalize before gen dispatch. */
type ProceduralKind = "city" | "pyramid" | "grass" | "trees";
const PROCEDURAL_KIND_ALIASES: Record<string, ProceduralKind> = {
  "procedural-city": "city",
  procedural_city: "city",
  citygrid: "city",
  "procedural-pyramid": "pyramid",
  procedural_pyramid: "pyramid",
  "procedural-grass": "grass",
  procedural_grass: "grass",
  "procedural-trees": "trees",
  procedural_trees: "trees",
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
    .pipe(z.enum(["city", "pyramid", "grass", "trees"]))
    .describe(
      'Use "city", "pyramid", "grass", or "trees". Synonyms like procedural-city / procedural-grass are normalized.'
    ),
  documentMode: z
    .string()
    .optional()
    .describe(
      'Optional. Default = "new". Use "replace" or "append" with documentId (UUID from list_documents) to target that doc; omit documentId to use tracked doc only.'
    ),
  documentId: documentIdUuidOptional.describe(
    "Optional. UUID when documentMode is replace or append—targets that document. Ignored for new."
  ),
  params: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Params per kind: pyramid (baseWidth, layers, blockSize, seed, cx, cz, cornerColors, cornerEmissionIntensity); city (rows/cols, blockSize, streetWidth, pyramidRow/pyramidCol) — building pool is filled from hub catalog when available; optional params.buildings array {id,name?,url?} to override; grass (patches, count, spreadMin/spreadMax, height, seed, margin, emissionIntensity); trees (count, catalogId, catalogIds[], seed, margin, collide)."
    ),
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
      "Walk to a *person* (use approachSessionId = their clientId or userId from occupants) or to raw x,z (use approachPosition). Use this for 'come here', 'go to the player who DMed you', or approaching someone in the occupants list. For world objects (pyramid, building, cube) use get_world_entities then move_to_entity instead. Or small steps: moveX/moveZ -0.4..0.4 only; 0,0 stops.",
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
    description:
      "List everyone in the block (observers, users, agents) with clientId, userId, position. Call when you need to approach someone and don't have their id—then use move(approachSessionId=clientId or userId).",
    schema: getOccupantsSchema,
  },
  {
    name: "get_world_entities",
    description:
      "List *world objects* (cubes, models, buildings, props) in this block with id and position. Call this when the user says 'go to the pyramid', 'move to that building', or 'go to that object'—then call move_to_entity(entityId). Do not use for people; for walking to a person use move(approachSessionId).",
    schema: getWorldEntitiesSchema,
  },
  {
    name: "move_to_entity",
    description:
      "Walk to a *world object* by entity id from get_world_entities. Use for pyramids, buildings, cubes, props. Call get_world_entities first to get the id. For walking to a *person* use move(approachSessionId) instead.",
    schema: moveToEntitySchema,
  },
  {
    name: "get_chat_history",
    description:
      "Get recent chat. Omit channelId for global room chat only. Set channelId to a DM thread id (dm:sessionA:sessionB) to load that private thread.",
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
      "Create a full scene with MML. x,z in [0,100). Default = new document (documentId ignored). replace_current/replace/update: pass documentId UUID to update that doc, or omit to replace tracked doc only.",
    schema: buildFullSchema,
  },
  {
    name: "build_with_code",
    description:
      "Like build_full but Gemini Python sandbox. Same document rules as build_full: new by default; replace/update with optional documentId UUID.",
    schema: buildFullSchema,
  },
  {
    name: "build_incremental",
    description:
      "Add MML as a fragment. x,z in [0,100) only like build_full. Default = new document with fragment only. Use documentTarget append_current/append only when explicitly appending to the tracked doc.",
    schema: buildIncrementalSchema,
  },
  {
    name: "list_documents",
    description:
      "List document ids (UUIDs). Pass to build_full replace, build_incremental append, generate_procedural replace/append, delete_document, get_document_content.",
    schema: listDocumentsSchema,
  },
  {
    name: "get_document_content",
    description:
      "Read stored MML for a document (what was actually saved). Use after build/update to verify contents or debug. Pass documentId or target current|last. Large docs return truncated—re-call list_documents if needed.",
    schema: getDocumentContentSchema,
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
      'Deterministic procedural MML (no LLM). kind: city, pyramid, grass, or trees. City defaults when params omitted: rows=5 cols=5 pyramid 1,1 blockSize=30 streetWidth=6 (same as test:create-city)—only pass rows/cols/blockSize/streetWidth if the user asks for a different size. Pyramid params (inside params): baseWidth, layers, blockSize, doorWidthBlocks, seed, cx, cz; optional cornerColors as array of hex strings for emissive corner cubes (one = all same; four = one per corner); optional cornerEmissionIntensity number. documentMode defaults to new; use replace or append only when explicitly told. Owner gate applies.',
    schema: generateProceduralSchema,
  },
];
