import type { ToolContext } from "../types.js";

export async function handleGetOccupants(ctx: ToolContext) {
  const { client, store, logAction } = ctx;
  const occupants = await client.getOccupants();
  const state = store.getState();
  store.setOccupants(occupants, state.mySessionId);
  const summary = `${occupants.length} occupants`;
  store.setLastOccupantsSummary(summary);
  logAction(summary);
  return { ok: true, summary };
}
