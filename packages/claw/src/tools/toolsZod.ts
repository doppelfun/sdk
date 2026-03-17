/**
 * Zod schemas and registry for claw tools (chat, move, get_occupants, build/recipe tools).
 * Recipe list for descriptions comes from lib/build/recipeKinds (single source).
 */
import { z } from "zod/v4";
import { RECIPE_KINDS_LIST } from "../lib/build/recipeKinds.js";
import {
  listCatalogSchema,
  listDocumentsSchema,
  getDocumentContentSchema,
  buildFullSchema,
  // buildIncrementalSchema,
  deleteDocumentSchema,
  deleteAllDocumentsSchema,
  runRecipeSchema,
} from "../lib/build/buildToolsZod.js";

export const approachPositionSchema = z.object({
  position: z.string().describe('Block-local coordinates "x,z" or "x,y,z" (0–100).'),
  sprint: z.boolean().optional(),
});

export const approachPersonSchema = z.object({
  sessionId: z.string().describe("Occupant clientId from get_occupants."),
  sprint: z.boolean().optional(),
});

export const stopSchema = z.object({
  jump: z.boolean().optional(),
});

export const followSchema = z.object({
  sessionId: z.string().describe("Occupant clientId from get_occupants to follow (server re-paths to their position periodically)."),
});

export const chatSchema = z.object({
  text: z.string().describe("Message text (max 500 chars)"),
  targetSessionId: z.string().optional().describe("Recipient session id for DM."),
  voiceId: z.string().optional(),
});

export const emoteSchema = z.object({
  emoteId: z.string().describe("Emote catalog id, e.g. wave, heart, spellcast."),
});

export const getOccupantsSchema = z.object({});

export const listRecipesSchema = z.object({});
export { runRecipeSchema };

/** Get the Zod schema for a tool by name (for parsing/validation). */
export function getToolSchema(name: string): z.ZodTypeAny | undefined {
  return CLAW_TOOL_REGISTRY.find((t) => t.name === name)?.schema;
}

export const CLAW_TOOL_REGISTRY: Array<{
  name: string;
  description: string;
  schema: z.ZodTypeAny;
}> = [
  {
    name: "approach_position",
    description: "Move to block-local coordinates (0–100). Pass position as 'x,z'.",
    schema: approachPositionSchema,
  },
  {
    name: "approach_person",
    description: "Move to a person's position. Pass sessionId (clientId from get_occupants).",
    schema: approachPersonSchema,
  },
  {
    name: "stop",
    description: "Stop moving.",
    schema: stopSchema,
  },
  {
    name: "follow",
    description: "Follow another person (re-path to their position periodically). Pass sessionId (clientId from get_occupants). Use stop to stop following.",
    schema: followSchema,
  },
  {
    name: "chat",
    description: "Send chat. Omit targetSessionId for global; set for DM so only you two see it.",
    schema: chatSchema,
  },
  {
    name: "emote",
    description: "Play an emote by catalog id (e.g. wave, heart, spellcast). Use for scheduled tasks or when the user asks you to emote.",
    schema: emoteSchema,
  },
  {
    name: "get_occupants",
    description: "List everyone currently in the block.",
    schema: getOccupantsSchema,
  },
  {
    name: "list_catalog",
    description:
      "List block catalog entries (id, name, url, category) from hub or engine. Call before building to pick catalogId for MML <m-model>. Read-only.",
    schema: listCatalogSchema,
  },
  {
    name: "list_documents",
    description:
      "List document ids (UUIDs). Use these ids for run_recipe replace/append, delete_document, get_document_content.",
    schema: listDocumentsSchema,
  },
  {
    name: "get_document_content",
    description:
      "Read stored MML for a document. Pass documentId or target current|last. Use after build to verify.",
    schema: getDocumentContentSchema,
  },
  {
    name: "list_recipes",
    description: `List available recipes (${RECIPE_KINDS_LIST}). Call before run_recipe to see options.`,
    schema: listRecipesSchema,
  },
  {
    name: "run_recipe",
    description: `Run a recipe to generate MML (no LLM). kind: ${RECIPE_KINDS_LIST}. documentMode: new, replace, or append. Params per recipe (see list_recipes).`,
    schema: runRecipeSchema,
  },
  {
    name: "build_full",
    description:
      "Create a full scene with MML via LLM. instruction: what to build. x,z in [0,100). Always creates a new document (delete/edit the latest via delete_document).",
    schema: buildFullSchema,
  },
  // build_incremental disabled: always add new document so user can delete/edit latest only
  // {
  //   name: "build_incremental",
  //   description:
  //     "Add MML fragment via LLM. instruction: what to add. Default = new document; use documentTarget append and optional documentId to append to existing.",
  //   schema: buildIncrementalSchema,
  // },
  {
    name: "build_with_code",
    description:
      "Build a scene using code (Python sandbox via Google Gemini). Use when the user asks to build 'using code', 'with code', 'programmatic', or 'with Python'. Same args as build_full (instruction, optional documentTarget/documentId). Requires LLM_PROVIDER=google and GOOGLE_API_KEY. If it fails, use build_full instead.",
    schema: buildFullSchema,
  },
  {
    name: "delete_document",
    description:
      "Delete one agent-owned document. Pass documentId or target current|last. To delete every document use delete_all_documents.",
    schema: deleteDocumentSchema,
  },
  {
    name: "delete_all_documents",
    description:
      "Delete every agent-owned document in the current block. Use when the user asks to clear/remove/delete all documents.",
    schema: deleteAllDocumentsSchema,
  },
];
