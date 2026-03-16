import type { ToolContext } from "../types.js";
import type { ClawStore } from "../../state/index.js";
import { parsePositionHint } from "../../../util/position.js";
import { clawLog } from "../../log.js";

function setApproachTarget(store: ClawStore, x: number, z: number, sprint: boolean): void {
  store.setMovementIntent(null);
  store.setMovementTarget({ x, z });
  store.setLastMoveToFailed(null);
  store.setMovementSprint(sprint);
  store.setAutonomousEmoteStandStillUntil(0);
}

function clearMovement(store: ClawStore): void {
  store.setMovementTarget(null);
  store.setMovementIntent(null);
  store.setMovementSprint(false);
}

export async function handleApproachPosition(ctx: ToolContext) {
  const { client, store, args, logAction } = ctx;
  const sprint = args.sprint === true;
  const position = typeof args.position === "string" ? args.position.trim() : "";
  if (!position) {
    return { ok: false, error: 'approach_position requires position: "x,z".' };
  }
  const parsed = parsePositionHint(position);
  if (!parsed) {
    return { ok: false, error: 'position must be like "x,z" or "x,y,z".' };
  }
  setApproachTarget(store, parsed.x, parsed.z, sprint);
  store.setLastBuildTarget({ x: parsed.x, z: parsed.z });
  client.moveTo(parsed.x, parsed.z);
  clawLog("approach_position", parsed.x, parsed.z);
  logAction(`approach (${parsed.x.toFixed(1)}, ${parsed.z.toFixed(1)})`);
  return { ok: true as const, summary: `approach (${parsed.x.toFixed(1)}, ${parsed.z.toFixed(1)})` };
}

export async function handleApproachPerson(ctx: ToolContext) {
  const { client, store, args, logAction } = ctx;
  const state = store.getState();
  const sprint = args.sprint === true;
  const sessionId = typeof args.sessionId === "string" ? args.sessionId.trim() : "";
  if (!sessionId) {
    return { ok: false, error: "approach_person requires sessionId (clientId from get_occupants)." };
  }
  const occ = state.occupants.find((o) => o.clientId === sessionId);
  if (!occ?.position) {
    return { ok: false, error: "approach_person requires an occupant with position—call get_occupants first." };
  }
  const toX = occ.position.x;
  const toZ = occ.position.z;
  setApproachTarget(store, toX, toZ, sprint);
  client.moveTo(toX, toZ);
  clawLog("approach_person", toX, toZ);
  logAction(`approach ${occ.username} at (${toX.toFixed(1)}, ${toZ.toFixed(1)})`);
  return { ok: true as const, summary: `approach ${occ.username}` };
}

export async function handleStop(ctx: ToolContext) {
  const { client, store, logAction } = ctx;
  const jump = ctx.args.jump === true;
  clearMovement(store);
  client.cancelMove();
  client.sendInput({ moveX: 0, moveZ: 0, sprint: false, jump });
  logAction("stop");
  return { ok: true as const, summary: "stop" };
}
