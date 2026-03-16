/**
 * Build and recipe tool handlers. Wrap build lib handlers for use with executeTool (ToolContext).
 * list_recipes calls @doppelfun/recipes; run_recipe and others use build handlers.
 */
import type { ToolContext, ExecuteToolResult } from "../types.js";
import { listProceduralKinds } from "@doppelfun/recipes";
import {
  handleListCatalog,
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
export const handleListDocumentsTool = wrapBuildHandler(handleListDocuments as BuildHandler);
export const handleGetDocumentContentTool = wrapBuildHandler(handleGetDocumentContent as BuildHandler);
export const handleRunRecipeTool = wrapBuildHandler(handleRunRecipe as BuildHandler);
export const handleBuildFullTool = wrapBuildHandler(handleBuildFull as BuildHandler);
export const handleBuildIncrementalTool = wrapBuildHandler(handleBuildIncremental as BuildHandler);
export const handleBuildWithCodeTool = wrapBuildHandler(handleBuildWithCode as BuildHandler);
export const handleDeleteDocumentTool = wrapBuildHandler(handleDeleteDocument as BuildHandler);
export const handleDeleteAllDocumentsTool = wrapBuildHandler(handleDeleteAllDocuments as BuildHandler);

/** List available recipe names from @doppelfun/recipes (city, pyramid, grass, trees). */
export async function handleListRecipes(_ctx: ToolContext): Promise<ExecuteToolResult> {
  const kinds = listProceduralKinds();
  const summary =
    kinds.length > 0
      ? `Available recipes: ${kinds.join(", ")}. Use run_recipe with kind=<name> and optional params (e.g. rows, cols, blockSize for city).`
      : "No recipes available.";
  return { ok: true, summary };
}
