/** Build tool handlers — re-exported for buildHandlers barrel. */
export { handleListCatalog, handleGenerateCatalogModel } from "./catalogHandlers.js";
export {
  handleListDocuments,
  handleGetDocumentContent,
  handleDeleteDocument,
  handleDeleteAllDocuments,
} from "./documentHandlers.js";
export { handleRunRecipe } from "./recipeHandler.js";
export {
  handleBuildFull,
  handleBuildIncremental,
  handleBuildWithCode,
} from "./buildLlmHandlers.js";
