/**
 * Build subagent tool set: wires Zod schemas + handlers into AI SDK tools.
 *
 * Handlers live in buildHandlers (barrel) and handlers/*. runHandler dispatches
 * by name and throws on { ok: false } so the agent sees the error message.
 */
import { tool, zodSchema } from "ai";
import type { DoppelClient } from "@doppelfun/sdk";
import type { ClawStore } from "../../../state/index.js";
import type { ClawConfig } from "../../../config/index.js";
import {
  listCatalogSchema,
  listDocumentsSchema,
  buildFullSchema,
  buildIncrementalSchema,
  getDocumentContentSchema,
  generateProceduralSchema,
  deleteDocumentSchema,
  deleteAllDocumentsSchema,
} from "./buildToolsZod.js";
import {
  handleListCatalog,
  handleListDocuments,
  handleGetDocumentContent,
  handleGenerateProcedural,
  handleBuildFull,
  handleBuildIncremental,
  handleBuildWithCode,
  handleDeleteDocument,
  handleDeleteAllDocuments,
} from "./buildHandlers.js";

export const BUILD_TOOL_NAMES = [
  "list_catalog",
  "list_documents",
  "get_document_content",
  "generate_procedural",
  "build_full",
  "build_incremental",
  "build_with_code",
  "delete_document",
  "delete_all_documents",
] as const;

function runHandler(
  name: string,
  client: DoppelClient,
  store: ClawStore,
  config: ClawConfig,
  args: Record<string, unknown>
): Promise<{ ok: true; summary: string } | { ok: false; error: string }> {
  switch (name) {
    case "list_catalog":
      return handleListCatalog(client, store, config, args as { limit?: number });
    case "list_documents":
      return handleListDocuments(client, store, config, args);
    case "get_document_content":
      return handleGetDocumentContent(client, store, config, args as { documentId?: string; target?: string });
    case "generate_procedural":
      return handleGenerateProcedural(client, store, config, args as Parameters<typeof handleGenerateProcedural>[3]);
    case "build_full":
      return handleBuildFull(client, store, config, args as Parameters<typeof handleBuildFull>[3]);
    case "build_incremental":
      return handleBuildIncremental(client, store, config, args as Parameters<typeof handleBuildIncremental>[3]);
    case "build_with_code":
      return handleBuildWithCode(client, store, config, args);
    case "delete_document":
      return handleDeleteDocument(client, store, config, args as { documentId?: string; target?: string });
    case "delete_all_documents":
      return handleDeleteAllDocuments(client, store, config, args);
    default:
      return Promise.resolve({ ok: false, error: `Unknown build tool: ${name}` });
  }
}

export function buildBuildToolSet(
  client: DoppelClient,
  store: ClawStore,
  config: ClawConfig,
  onToolResult?: (name: string, args: unknown, result: { ok: true; summary: string } | { ok: false; error: string }) => void
): Record<string, ReturnType<typeof tool>> {
  const execute = (name: string) => async (args: unknown) => {
    const record = args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
    const result = await runHandler(name, client, store, config, record);
    onToolResult?.(name, args, result);
    if (!result.ok) throw new Error(result.error);
    return result.summary;
  };

  return {
    list_catalog: tool({
      description:
        "List block catalog entries (id, name, url, category) from hub or engine. Call before building to pick catalogId for MML <m-model>. Read-only.",
      inputSchema: zodSchema(listCatalogSchema),
      execute: execute("list_catalog"),
    }),
    list_documents: tool({
      description:
        "List document ids (UUIDs). Use these ids for build_full replace, build_incremental append, generate_procedural replace/append, delete_document, get_document_content.",
      inputSchema: zodSchema(listDocumentsSchema),
      execute: execute("list_documents"),
    }),
    get_document_content: tool({
      description:
        "Read stored MML for a document. Pass documentId or target current|last. Use after build to verify.",
      inputSchema: zodSchema(getDocumentContentSchema),
      execute: execute("get_document_content"),
    }),
    generate_procedural: tool({
      description:
        "Deterministic procedural MML (no LLM). kind: city, pyramid, grass, or trees. documentMode: new (default), replace, or append. Params per kind (e.g. rows, cols, blockSize for city).",
      inputSchema: zodSchema(generateProceduralSchema),
      execute: execute("generate_procedural"),
    }),
    build_full: tool({
      description:
        "Create a full scene with MML via LLM. instruction: what to build. x,z in [0,100). Default = new document; use documentTarget replace/update and optional documentId to update existing.",
      inputSchema: zodSchema(buildFullSchema),
      execute: execute("build_full"),
    }),
    build_incremental: tool({
      description:
        "Add MML fragment via LLM. instruction: what to add. Default = new document; use documentTarget append and optional documentId to append to existing.",
      inputSchema: zodSchema(buildIncrementalSchema),
      execute: execute("build_incremental"),
    }),
    build_with_code: tool({
      description:
        "Build a scene using code (Python sandbox via Google Gemini). Use when the user asks to build 'using code', 'with code', 'programmatic', or 'with Python'. Same args as build_full (instruction, optional documentTarget/documentId). Requires LLM_PROVIDER=google and GOOGLE_API_KEY. If it fails, use build_full instead.",
      inputSchema: zodSchema(buildFullSchema),
      execute: execute("build_with_code"),
    }),
    delete_document: tool({
      description:
        "Delete one agent-owned document. Pass documentId or target current|last. To delete every document use delete_all_documents.",
      inputSchema: zodSchema(deleteDocumentSchema),
      execute: execute("delete_document"),
    }),
    delete_all_documents: tool({
      description:
        "Delete every agent-owned document in the current block. Use when the user asks to clear/remove/delete all documents.",
      inputSchema: zodSchema(deleteAllDocumentsSchema),
      execute: execute("delete_all_documents"),
    }),
  } as unknown as Record<string, ReturnType<typeof tool>>;
}
