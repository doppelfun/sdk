import type { ToolContext } from "../types.js";
import { getBlockBounds } from "../../../util/blockBounds.js";
import { buildFull, buildFullWithCodeExecution } from "../../llm/buildLlm.js";
import { createLlmProvider } from "../../llm/provider.js";
import { getCatalogForBuild, catalogToJson } from "../shared/catalog.js";
import { ownerGateDenied, preCheckBalance, reportBuildUsage } from "../shared/gate.js";
import { persistFullBuildMml } from "../shared/buildPersistence.js";

export async function handleBuildFull(ctx: ToolContext) {
  const { client, state, config, args, logAction } = ctx;
  const instruction = typeof args.instruction === "string" ? args.instruction.trim() : "";
  if (!instruction) return { ok: false, error: "build_full requires instruction" };
  const denied = ownerGateDenied(config, state);
  if (denied) return denied;
  const balErr = await preCheckBalance(config);
  if (balErr) return { ok: false, error: balErr };
  const catalog = await getCatalogForBuild(config);
  const blockBounds = getBlockBounds(state.blockSlotId);
  client.sendThinking(true);
  let result: Awaited<ReturnType<typeof buildFull>>;
  try {
    result = await buildFull(
      createLlmProvider(config),
      config.buildLlmModel,
      instruction,
      catalogToJson(catalog),
      blockBounds
    );
  } finally {
    client.sendThinking(false);
  }
  if (!result.ok) return result;
  reportBuildUsage(config, result.usage);
  const buildResult = await persistFullBuildMml(client, state, result.mml, args);
  if (buildResult.ok && buildResult.summary) logAction(buildResult.summary);
  return buildResult;
}

export async function handleBuildWithCode(ctx: ToolContext) {
  const { client, state, config, args, logAction } = ctx;
  const instruction = typeof args.instruction === "string" ? args.instruction.trim() : "";
  if (!instruction) return { ok: false, error: "build_with_code requires instruction" };
  const denied = ownerGateDenied(config, state);
  if (denied) return denied;
  const balErr = await preCheckBalance(config);
  if (balErr) return { ok: false, error: balErr };
  const blockBounds = getBlockBounds(state.blockSlotId);
  client.sendThinking(true);
  let result: Awaited<ReturnType<typeof buildFullWithCodeExecution>>;
  try {
    result = await buildFullWithCodeExecution(
      createLlmProvider(config),
      config.buildLlmModel,
      instruction,
      blockBounds
    );
  } finally {
    client.sendThinking(false);
  }
  if (!result.ok) return result;
  reportBuildUsage(config, result.usage);
  const buildResult = await persistFullBuildMml(client, state, result.mml, args);
  if (buildResult.ok && buildResult.summary) logAction(buildResult.summary);
  return buildResult;
}
