/**
 * Movement tool handlers: approach_position, approach_person, stop.
 * All use server-driven move_to (pathfinding on server); stop sends cancel_move + input 0,0.
 */
import type { ToolContext } from "../types.js";
import type { ClawStore } from "../../state/index.js";
import { parsePositionHint } from "../../../util/position.js";
import { clawLog } from "../../log.js";

/** Set target for approach; server drives movement via move_to. Client only checks arrival. */
function setApproachTarget(store: ClawStore, x: number, z: number, sprint: boolean): void {
  store.setMovementIntent(null);
  store.setMovementTarget({ x, z });
  store.setLastMoveToFailed(null);
  store.setMovementSprint(sprint);
  store.setAutonomousEmoteStandStillUntil(0);
}

/** Clear target and tell server to stop. */
function clearMovement(store: ClawStore): void {
  store.setMovementTarget(null);
  store.setMovementIntent(null);
  store.setMovementSprint(false);
}

/**
 * approach_position: move to block-local coordinates. Server pathfinds via move_to.
 * @see ../../movement/MOVEMENT.md
 */
export async function handleApproachPosition(ctx: ToolContext) {
  const { client, store, args, logAction } = ctx;
  const sprint = args.sprint === true;
  const position = typeof args.position === "string" ? args.position.trim() : "";
  if (!position) {
    return { ok: false, error: 'approach_position requires position: "x,z" (block-local 0–100).' };
  }
  const parsed = parsePositionHint(position);
  if (!parsed) {
    return { ok: false, error: 'position must be like "x,z" or "x,y,z" (block-local 0–100).' };
  }
  setApproachTarget(store, parsed.x, parsed.z, sprint);
  store.setLastBuildTarget({ x: parsed.x, z: parsed.z });
  client.moveTo(parsed.x, parsed.z);
  clawLog("approach_position: move_to", parsed.x.toFixed(1), parsed.z.toFixed(1), "→ server drives");
  logAction(`approach (${parsed.x.toFixed(1)}, ${parsed.z.toFixed(1)}) — server pathfinding until within ~1 m`);
  return { ok: true, summary: `approach (${parsed.x.toFixed(1)}, ${parsed.z.toFixed(1)})` };
}

/**
 * approach_person: move to an occupant's position. Server pathfinds via move_to.
 * @see ../../movement/MOVEMENT.md
 */
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
    return {
      ok: false,
      error: "approach_person requires an occupant with position—call get_occupants first and use clientId.",
    };
  }
  const toX = occ.position.x;
  const toZ = occ.position.z;
  setApproachTarget(store, toX, toZ, sprint);
  client.moveTo(toX, toZ);
  clawLog("approach_person: move_to", toX.toFixed(1), toZ.toFixed(1), "→ server drives");
  logAction(`approach ${occ.username} at (${toX.toFixed(1)}, ${toZ.toFixed(1)}) — server pathfinding`);
  return { ok: true, summary: `approach ${occ.username} at (${toX.toFixed(1)}, ${toZ.toFixed(1)})` };
}

/**
 * stop: clear movement target and tell server to stop (cancel_move so server drops path; then 0,0 input).
 * @see ../../movement/MOVEMENT.md
 */
export async function handleStop(ctx: ToolContext) {
  const { client, store, logAction } = ctx;
  const jump = ctx.args.jump === true;
  clearMovement(store);
  client.cancelMove();
  client.sendInput({ moveX: 0, moveZ: 0, sprint: false, jump });
  logAction("stop");
  return { ok: true, summary: "stop" };
}
