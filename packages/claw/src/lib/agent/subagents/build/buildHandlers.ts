/**
 * Build subagent tool handlers — barrel.
 *
 * Handlers are split by concern:
 * - handlers/catalogHandlers   — list_catalog
 * - handlers/documentHandlers — list_documents, get_document_content, delete_document, delete_all_documents
 * - handlers/proceduralHandler — generate_procedural (city, pyramid, grass, trees)
 * - handlers/buildLlmHandlers  — build_full, build_incremental, build_with_code (multistep LLM flows)
 *
 * Shared step logging and helpers live in buildSteps.ts.
 */

export type { BuildToolResult } from "./buildSteps.js";

export { handleListCatalog } from "./handlers/catalogHandlers.js";
export {
  handleListDocuments,
  handleGetDocumentContent,
  handleDeleteDocument,
  handleDeleteAllDocuments,
} from "./handlers/documentHandlers.js";
export { handleGenerateProcedural } from "./handlers/proceduralHandler.js";
export {
  handleBuildFull,
  handleBuildIncremental,
  handleBuildWithCode,
} from "./handlers/buildLlmHandlers.js";
