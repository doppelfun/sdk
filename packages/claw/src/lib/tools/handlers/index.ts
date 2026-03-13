import type { ToolHandler } from "../types.js";
import { handleMove } from "./move.js";
import { handleChat } from "./chat.js";
import { handleEmote } from "./emote.js";
import { handleJoinBlock } from "./joinBlock.js";
import { handleGetOccupants } from "./occupants.js";
import { handleGetChatHistory } from "./chatHistory.js";
import { handleListCatalog } from "./listCatalog.js";
import { handleBuildFull, handleBuildWithCode } from "./buildFull.js";
import { handleBuildIncremental } from "./buildIncremental.js";
import {
  handleListDocuments,
  handleGetDocumentContent,
  handleDeleteDocument,
  handleDeleteAllDocuments,
} from "./documentTools.js";
import { handleGenerateProcedural } from "./generateProcedural.js";

export const TOOL_HANDLERS = {
  move: handleMove,
  chat: handleChat,
  emote: handleEmote,
  join_block: handleJoinBlock,
  get_occupants: handleGetOccupants,
  get_chat_history: handleGetChatHistory,
  list_catalog: handleListCatalog,
  build_full: handleBuildFull,
  build_with_code: handleBuildWithCode,
  build_incremental: handleBuildIncremental,
  list_documents: handleListDocuments,
  get_document_content: handleGetDocumentContent,
  delete_document: handleDeleteDocument,
  delete_all_documents: handleDeleteAllDocuments,
  generate_procedural: handleGenerateProcedural,
} as Record<string, ToolHandler>;
