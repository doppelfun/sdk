/**
 * Build tool handlers — barrel.
 *
 * Handlers are split by concern:
 * - handlers/catalogHandlers   — list_catalog
 * - handlers/documentHandlers — list_documents, get_document_content, delete_document, delete_all_documents
 * - handlers/recipeHandler — run_recipe (city, pyramid, grass, trees)
 * - handlers/buildLlmHandlers  — build_full, build_incremental, build_with_code (multistep LLM flows)
 *
 * Shared step logging and helpers live in buildSteps.ts.
 */

export type { BuildToolResult } from "./buildSteps.js";

export {
  handleListCatalog,
  handlePlaceCatalogModel,
  handleListDocuments,
  handleGetDocumentContent,
  handleDeleteDocument,
  handleDeleteAllDocuments,
  handleRunRecipe,
  handleBuildFull,
  handleBuildIncremental,
  handleBuildWithCode,
} from "./handlers/index.js";
