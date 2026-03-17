/**
 * Build and recipe tool handlers. Wrap build lib handlers for executeTool (ToolContext).
 */
import type { ToolContext, ExecuteToolResult } from "../types.js";
import { RECIPE_KINDS } from "../../lib/build/recipeKinds.js";
import {
  handleListCatalog,
  handleGenerateCatalogModel,
  handleListDocuments,
  handleGetDocumentContent,
  handleRunRecipe,
  handleBuildFull,
  handleBuildIncremental,
  handleBuildWithCode,
  handleDeleteDocument,
  handleDeleteAllDocuments,
} from "../../lib/build/buildHandlers.js";

type BuildHandler = (
  client: ToolContext["client"],
  store: ToolContext["store"],
  config: ToolContext["config"],
  args: Record<string, unknown>
) => Promise<ExecuteToolResult>;

function wrapBuildHandler(handler: BuildHandler): (ctx: ToolContext) => Promise<ExecuteToolResult> {
  return (ctx) => handler(ctx.client, ctx.store, ctx.config, ctx.args);
}

export const handleListCatalogTool = wrapBuildHandler(handleListCatalog as BuildHandler);
export const handleGenerateCatalogModelTool = wrapBuildHandler(handleGenerateCatalogModel as BuildHandler);
export const handleListDocumentsTool = wrapBuildHandler(handleListDocuments as BuildHandler);
export const handleGetDocumentContentTool = wrapBuildHandler(handleGetDocumentContent as BuildHandler);
export const handleRunRecipeTool = wrapBuildHandler(handleRunRecipe as BuildHandler);
export const handleBuildFullTool = wrapBuildHandler(handleBuildFull as BuildHandler);
export const handleBuildIncrementalTool = wrapBuildHandler(handleBuildIncremental as BuildHandler);
export const handleBuildWithCodeTool = wrapBuildHandler(handleBuildWithCode as BuildHandler);
export const handleDeleteDocumentTool = wrapBuildHandler(handleDeleteDocument as BuildHandler);
export const handleDeleteAllDocumentsTool = wrapBuildHandler(handleDeleteAllDocuments as BuildHandler);

/** List available recipe names (from recipeKinds). */
export async function handleListRecipes(_ctx: ToolContext): Promise<ExecuteToolResult> {
  const summary =
    RECIPE_KINDS.length > 0
      ? `Available recipes: ${RECIPE_KINDS.join(", ")}. Use run_recipe with kind and optional params.`
      : "No recipes available.";
  return { ok: true, summary };
}
