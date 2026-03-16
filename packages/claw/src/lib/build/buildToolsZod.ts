/**
 * Zod schemas for build tools (list_catalog, list_documents, get_document_content,
 * list_recipes, run_recipe, build_full, build_incremental, build_with_code,
 * delete_document, delete_all_documents).
 */
import { z } from "zod/v4";

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
    { message: "documentId must be a UUID from list_documents only." }
  );

export const listCatalogSchema = z.object({
  limit: z.number().optional().describe("Max entries to include (default 100, max 200)."),
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

/** Normalize kind aliases (e.g. "procedural-city" from LLM) to recipe id. */
const kindAliases: Record<string, "city" | "pyramid" | "grass" | "trees"> = {
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

export const runRecipeSchema = z.object({
  kind: z
    .string()
    .transform((s) => kindAliases[s.trim().toLowerCase()] ?? s.trim().toLowerCase())
    .pipe(z.enum(["city", "pyramid", "grass", "trees"]))
    .describe('Recipe kind: city, pyramid, grass, or trees.'),
  documentMode: z.string().optional().describe('Optional. "new", "replace", or "append".'),
  documentId: documentIdUuidOptional,
  params: z.record(z.string(), z.unknown()).optional().describe("Params per recipe (e.g. rows, cols, blockSize for city)."),
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
