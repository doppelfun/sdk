import type { ToolContext } from "../types.js";
import { clearConversation } from "../../conversation/index.js";

export async function handleJoinBlock(ctx: ToolContext) {
  const { client, store, args, logAction } = ctx;
  const blockSlotId = typeof args.blockSlotId === "string" ? args.blockSlotId : "";
  if (blockSlotId) {
    client.sendJoin(blockSlotId);
    store.resetForJoinBlock(blockSlotId);
    clearConversation(store, { skipSeekCooldown: true });
  }
  logAction(blockSlotId ? `join block ${blockSlotId}` : "join_block (no slot)");
  return { ok: true, summary: `join block ${blockSlotId}` };
}
