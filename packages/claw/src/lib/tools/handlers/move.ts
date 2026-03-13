import type { ToolContext } from "../types.js";
import { parsePositionHint } from "../../../util/position.js";

const MAX_MOVE = 0.4;

export async function handleMove(ctx: ToolContext) {
  const { client, store, args, logAction } = ctx;
  const state = store.getState();
  const rawX = typeof args.moveX === "number" ? args.moveX : 0;
  const rawZ = typeof args.moveZ === "number" ? args.moveZ : 0;
  const sprint = args.sprint === true;
  const jump = args.jump === true;

  const approachSessionId =
    typeof args.approachSessionId === "string" ? args.approachSessionId.trim() : "";
  const approachPosition =
    typeof args.approachPosition === "string" ? args.approachPosition.trim() : "";

  if (approachSessionId) {
    const occ = state.occupants.find((o) => o.clientId === approachSessionId);
    if (!occ?.position) {
      return {
        ok: false,
        error:
          "approachSessionId requires occupant with position—call get_occupants first and use clientId from context.",
      };
    }
    store.setMovementIntent(null);
    store.setMovementTarget({ x: occ.position.x, z: occ.position.z });
    store.setMovementSprint(sprint);
    client.sendInput({ moveX: 0, moveZ: 0, sprint: false, jump: false });
    const summary = `approach ${occ.username} at (${occ.position.x.toFixed(1)}, ${occ.position.z.toFixed(1)}) — auto-walk until close`;
    logAction(summary);
    return { ok: true, summary };
  }

  if (approachPosition) {
    const parsed = parsePositionHint(approachPosition);
    if (!parsed) {
      return { ok: false, error: 'approachPosition must be like "x,z" or "x,y,z" (world coords)' };
    }
    store.setMovementIntent(null);
    store.setMovementTarget({ x: parsed.x, z: parsed.z });
    store.setLastBuildTarget({ x: parsed.x, z: parsed.z });
    store.setMovementSprint(sprint);
    client.sendInput({ moveX: 0, moveZ: 0, sprint: false, jump: false });
    const summary = `approach (${parsed.x.toFixed(1)}, ${parsed.z.toFixed(1)}) — auto-walk until within ~2 m`;
    logAction(summary);
    return { ok: true, summary };
  }

  if (rawX === 0 && rawZ === 0) {
    store.setMovementTarget(null);
    store.setMovementIntent(null);
    store.setMovementSprint(false);
    client.sendInput({ moveX: 0, moveZ: 0, sprint: false, jump });
    logAction("move stop");
    return { ok: true, summary: "move stop" };
  }

  const moveX = Math.max(-MAX_MOVE, Math.min(MAX_MOVE, rawX));
  const moveZ = Math.max(-MAX_MOVE, Math.min(MAX_MOVE, rawZ));
  store.setMovementIntent({ moveX, moveZ, sprint });
  store.setMovementTarget(null);
  client.sendInput({ moveX, moveZ, sprint, jump: false });
  const summary = `move ${moveX},${moveZ} (held until move 0,0 or approach*)`;
  logAction(summary);
  return { ok: true, summary };
}
