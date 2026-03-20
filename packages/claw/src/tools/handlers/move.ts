/**
 * Movement tool handlers: approach_position, approach_person, follow, stop.
 */
import type { ToolContext } from "../types.js";
import type { ClawStore } from "../../lib/state/index.js";
import { parsePositionHint } from "../../util/position.js";
import { clawLog } from "../../util/log.js";

/** Set store movement target and intent; clear failed state; call client.moveTo. */
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
  store.setFollowTargetSessionId(null);
}

/**
 * Handle approach_position: parse "x,z" or "x,y,z", set target, call client.moveTo.
 *
 * @param ctx - Tool context (args.position, args.sprint)
 * @returns ExecuteToolResult
 */
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

/**
 * Handle approach_person: resolve sessionId to occupant position, set target, call client.moveTo.
 *
 * @param ctx - Tool context (args.sessionId, args.sprint)
 * @returns ExecuteToolResult
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

/**
 * Handle follow: set follow target by sessionId, call client.follow. Server re-paths to target's position periodically.
 *
 * @param ctx - Tool context (args.sessionId)
 * @returns ExecuteToolResult
 */
export async function handleFollow(ctx: ToolContext) {
  const { client, store, args, logAction } = ctx;
  const sessionId = typeof args.sessionId === "string" ? args.sessionId.trim() : "";
  if (!sessionId) {
    return { ok: false, error: "follow requires sessionId (clientId from get_occupants)." };
  }
  const state = store.getState();
  const occ = state.occupants.find((o) => o.clientId === sessionId);
  if (!occ?.position) {
    return { ok: false, error: "follow requires an occupant with position—call get_occupants first." };
  }
  if (sessionId === state.mySessionId) {
    return { ok: false, error: "Cannot follow yourself." };
  }
  clearMovement(store);
  store.setFollowTargetSessionId(sessionId);
  client.follow(sessionId);
  clawLog("follow", sessionId);
  logAction(`follow ${occ.username}`);
  return { ok: true as const, summary: `following ${occ.username}` };
}

/**
 * Handle stop: clear movement target and intent, cancel move and follow, send zero input.
 *
 * @param ctx - Tool context
 * @returns ExecuteToolResult
 */
export async function handleStop(ctx: ToolContext) {
  const { client, store, logAction } = ctx;
  const jump = ctx.args.jump === true;
  clearMovement(store);
  client.cancelMove();
  client.cancelFollow();
  client.sendInput({ moveX: 0, moveZ: 0, sprint: false, jump });
  logAction("stop");
  return { ok: true as const, summary: "stop" };
}
