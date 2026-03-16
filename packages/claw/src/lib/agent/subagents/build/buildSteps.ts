/**
 * Shared step logging and helpers for build_full, build_incremental, build_with_code.
 * Keeps multistep flows DRY and makes it clear what happens at each step.
 */
import type { DoppelClient } from "@doppelfun/sdk";
import type { ClawStore } from "../../../state/index.js";
import type { ClawConfig } from "../../../config/index.js";
import type { LanguageModel } from "ai";
import { clawLog } from "../../../log.js";
import { getBlockBounds } from "../../../../util/blockBounds.js";
import { resolveBuildLanguageModel } from "../../../llm/toolsAi.js";
import { getCatalogForBuild, catalogToJson } from "../../../build/catalog.js";
import type { CatalogEntry } from "../../../build/catalog.js";

/** Result type for all build tool handlers. */
export type BuildToolResult =
  | { ok: true; summary: string }
  | { ok: false; error: string };

/** Result of resolving model + catalog + bounds (shared by build_full and build_incremental). */
export type ModelCatalogContext = {
  model: LanguageModel;
  catalog: CatalogEntry[];
  blockBounds: ReturnType<typeof getBlockBounds>;
};

/**
 * Log the start of a step. Use with logStepOk / logStepFailed.
 * @param tool - Tool name (e.g. "build_full")
 * @param step - Current step number (1-based)
 * @param total - Total steps
 * @param description - Short description of what this step does
 */
export function logStep(tool: string, step: number, total: number, description: string, ...extra: unknown[]): void {
  clawLog(`build: ${tool} step ${step}/${total}:`, description, ...extra);
}

/** Log step success. */
export function logStepOk(tool: string, step: number, total: number, ...extra: unknown[]): void {
  clawLog(`build: ${tool} step ${step}/${total} ok`, ...extra);
}

/**
 * Log step failure and what to do next.
 * @param tool - Tool name
 * @param step - Step number
 * @param total - Total steps
 * @param message - Error or short reason
 * @param whatToDo - Optional hint (e.g. "Set BUILD_LLM_MODEL")
 */
export function logStepFailed(tool: string, step: number, total: number, message: string, whatToDo?: string): void {
  const suffix = whatToDo ? `. ${whatToDo}` : "";
  clawLog(`build: ${tool} step ${step}/${total} FAILED —`, message, suffix);
}

/**
 * Run an async function while sending thinking(true) before and thinking(false) after.
 * Used so the client can show a "thinking" state during LLM or long work.
 */
export async function withThinking<T>(
  client: DoppelClient,
  fn: () => Promise<T>
): Promise<T> {
  const sendThinking = (client as unknown as { sendThinking?: (v: boolean) => void }).sendThinking;
  if (typeof sendThinking === "function") sendThinking.call(client, true);
  try {
    return await fn();
  } finally {
    if (typeof sendThinking === "function") sendThinking.call(client, false);
  }
}

/**
 * Resolve build model, load catalog, and get block bounds.
 * Shared by build_full and build_incremental (build_with_code only needs bounds).
 */
export async function resolveModelAndCatalog(
  config: ClawConfig,
  store: ClawStore
): Promise<{ ok: true; ctx: ModelCatalogContext } | { ok: false; error: string }> {
  const model = resolveBuildLanguageModel(config);
  if (!model) {
    return { ok: false, error: "No build model configured (BUILD_LLM_MODEL)" };
  }
  const catalog = await getCatalogForBuild(config);
  const blockBounds = getBlockBounds(store.getState().blockSlotId);
  return { ok: true, ctx: { model, catalog, blockBounds } };
}

/** Truncate a string for log lines. */
export function truncateForLog(s: string, maxLen: number): string {
  return s.slice(0, maxLen) + (s.length > maxLen ? "…" : "");
}
