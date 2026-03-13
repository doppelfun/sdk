import type { ToolContext } from "../types.js";

export async function handleGetOccupants(ctx: ToolContext) {
  const { client, state, logAction } = ctx;
  const occupants = await client.getOccupants();
  state.occupants = occupants;
  const self = state.mySessionId
    ? occupants.find((o) => o.clientId === state.mySessionId && o.position)
    : null;
  state.myPosition = self?.position ?? null;
  const summary = `${occupants.length} occupants`;
  state.lastOccupantsSummary = summary;
  logAction(summary);
  return { ok: true, summary };
}
