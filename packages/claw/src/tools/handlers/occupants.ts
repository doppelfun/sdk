/**
 * get_occupants tool handler: fetch occupants from client, update store, return count summary.
 */
import type { ToolContext } from "../types.js";

/**
 * Handle get_occupants: call client.getOccupants(), store in state, return summary.
 *
 * @param ctx - Tool context (client, store)
 * @returns ExecuteToolResult with summary like "3 occupants"
 */
export async function handleGetOccupants(ctx: ToolContext) {
  const { client, store, logAction } = ctx;
  const occupants = await client.getOccupants();
  const state = store.getState();
  store.setOccupants(occupants, state.mySessionId);
  const summary = `${occupants.length} occupants`;
  store.setLastOccupantsSummary(summary);
  logAction(summary);
  return { ok: true as const, summary };
}
