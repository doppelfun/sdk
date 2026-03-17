/**
 * Map of tool name to handler. Used by executeTool in tools/index.
 */
import type { ToolHandler } from "../types.js";
import { handleApproachPosition, handleApproachPerson, handleFollow, handleStop } from "./move.js";
import { handleChat } from "./chat.js";
import { handleStartConversation } from "./startConversation.js";
import { handleEmote } from "./emote.js";
import { handleGetOccupants } from "./occupants.js";
import {
  handleListCatalogTool,
  handleGenerateCatalogModelTool,
  handleListDocumentsTool,
  handleGetDocumentContentTool,
  handleListRecipes,
  handleRunRecipeTool,
  handleBuildFullTool,
  // handleBuildIncrementalTool, // disabled: always add new document so user can delete/edit latest only
  handleBuildWithCodeTool,
  handleDeleteDocumentTool,
  handleDeleteAllDocumentsTool,
} from "./build.js";

/** Registry of tool name → handler for chat, move, get_occupants, build/recipe. */
export const TOOL_HANDLERS: Record<string, ToolHandler> = {
  approach_position: handleApproachPosition,
  approach_person: handleApproachPerson,
  follow: handleFollow,
  stop: handleStop,
  chat: handleChat,
  start_conversation: handleStartConversation,
  emote: handleEmote,
  get_occupants: handleGetOccupants,
  list_catalog: handleListCatalogTool,
  generate_catalog_model: handleGenerateCatalogModelTool,
  list_documents: handleListDocumentsTool,
  get_document_content: handleGetDocumentContentTool,
  list_recipes: handleListRecipes,
  run_recipe: handleRunRecipeTool,
  build_full: handleBuildFullTool,
  // build_incremental: handleBuildIncrementalTool, // disabled
  build_with_code: handleBuildWithCodeTool,
  delete_document: handleDeleteDocumentTool,
  delete_all_documents: handleDeleteAllDocumentsTool,
};
