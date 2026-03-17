/**
 * Zod schemas for build tools (list_catalog, list_documents, get_document_content,
 * list_recipes, run_recipe, build_full, build_incremental, build_with_code,
 * delete_document, delete_all_documents).
 * Recipe kinds come from lib/build/recipeKinds (single source from @doppelfun/recipes).
 */
import { z } from "zod/v4";
import { RECIPE_KINDS } from "./recipeKinds.js";

const DOCUMENT_ID_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** documentId must be a UUID from list_documents (used by build/recipe tools). */
const documentIdUuidOptional = z
  .string()
  .optional()
  .refine(
    (s) =>
      s === undefined ||
      String(s).trim() === "" ||
      DOCUMENT_ID_UUID_RE.test(String(s).trim()),
    { message: "documentId must be a UUID from list_documents only." }
  );

export const listCatalogSchema = z.object({
  limit: z.number().optional().describe("Max entries to include (default 100, max 200)."),
});

export const generateCatalogModelSchema = z.object({
  prompt: z.string().min(1).describe("Text description of the 3D model to generate (e.g. 'cyberpunk skyscraper')."),
  name: z.string().optional().describe("Optional display name for the catalog asset."),
  category: z.string().optional().describe("Optional category (default Cyberpunk)."),
});

export const listDocumentsSchema = z.object({});

export const buildFullSchema = z.object({
  instruction: z.string().describe("What to build"),
  documentTarget: z
    .string()
    .optional()
    .describe('Optional. Default = new. Use "replace_current"/"replace"/"update" to update in place.'),
  documentId: documentIdUuidOptional,
});

export const buildIncrementalSchema = z.object({
  instruction: z.string().describe("What to add and where"),
  documentTarget: z
    .string()
    .optional()
    .describe('Optional. Default = new document. Use "append_current" or "append" to append.'),
  documentId: documentIdUuidOptional,
  position: z.string().optional().describe("Optional position hint (e.g. 5,0,5)"),
});

export const getDocumentContentSchema = z.object({
  documentId: documentIdUuidOptional,
  target: z.string().optional().describe('Optional. "current" or "last".'),
});

export const deleteDocumentSchema = z.object({
  documentId: documentIdUuidOptional,
  target: z.string().optional().describe('Optional. "current" or "last".'),
});

export const deleteAllDocumentsSchema = z.object({});

/** Alias map: LLM-friendly names (recipe-X, procedural-X) → canonical recipe id. */
const kindAliases: Record<string, string> = {};
for (const id of RECIPE_KINDS) {
  kindAliases[`recipe-${id}`] = id;
  kindAliases[`recipe_${id}`] = id;
  kindAliases[`procedural-${id}`] = id;
  kindAliases[`procedural_${id}`] = id;
}

export const runRecipeSchema = z.object({
  kind: z
    .string()
    .transform((s) => kindAliases[s.trim().toLowerCase()] ?? s.trim().toLowerCase())
    .refine((k) => RECIPE_KINDS.includes(k), {
      message: `Recipe kind must be one of: ${RECIPE_KINDS.join(", ")}. Call list_recipes to see options.`,
    })
    .describe(`Recipe kind: one of ${RECIPE_KINDS.join(", ")}.`),
  documentMode: z.string().optional().describe('Optional. "new", "replace", or "append".'),
  documentId: documentIdUuidOptional,
  params: z.record(z.string(), z.unknown()).optional().describe("Params per recipe (see list_recipes / recipe manifest)."),
});

export type BuildToolArgs = {
  list_catalog: z.infer<typeof listCatalogSchema>;
  list_documents: z.infer<typeof listDocumentsSchema>;
  build_full: z.infer<typeof buildFullSchema>;
  build_incremental: z.infer<typeof buildIncrementalSchema>;
  build_with_code: z.infer<typeof buildFullSchema>;
  run_recipe: z.infer<typeof runRecipeSchema>;
  get_document_content: z.infer<typeof getDocumentContentSchema>;
  delete_document: z.infer<typeof deleteDocumentSchema>;
  delete_all_documents: z.infer<typeof deleteAllDocumentsSchema>;
};
