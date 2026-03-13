import type { ToolContext } from "../types.js";
import { syncMainDocumentForBlock } from "../../state/state.js";
import { clearConversation } from "../../conversation/index.js";

export async function handleJoinBlock(ctx: ToolContext) {
  const { client, state, args, logAction } = ctx;
  const blockSlotId = typeof args.blockSlotId === "string" ? args.blockSlotId : "";
  if (blockSlotId) {
    client.sendJoin(blockSlotId);
    state.blockSlotId = blockSlotId;
    state.lastError = null;
    state.myPosition = null;
    state.lastBuildTarget = null;
    state.movementTarget = null;
    state.movementIntent = null;
    state.pendingGoTalkToAgent = null;
    state.autonomousSeekCooldownUntil = 0;
    clearConversation(state, { skipSeekCooldown: true });
    state.lastToolRun = null;
    state.lastCatalogContext = null;
    state.lastDocumentsList = null;
    state.lastOccupantsSummary = null;
    syncMainDocumentForBlock(state);
  }
  logAction(blockSlotId ? `join block ${blockSlotId}` : "join_block (no slot)");
  return { ok: true, summary: `join block ${blockSlotId}` };
}
