# Movement (server-driven move_to)

Movement is a **two-phase flow**:

1. **Initiate (movement tools)** – When the LLM calls `approach_position` (with position "x,z") or `approach_person` (with sessionId), the handler sets `movementTarget` and calls `client.moveTo(x, z)`. The server pathfinds and drives the agent each tick. Call `stop` to clear the target and stop moving.

2. **Execute (50 ms loop)** – `movementDriverTick` runs every ~50 ms. If `movementTarget` is set and there are no client-side waypoints, the **server** is driving movement; the client only checks arrival (distance &lt; stop distance), then clears target and runs arrival logic (e.g. pendingGoTalkToAgent). Stick input (`movementIntent`) is sent every tick when there is no target.

Sending a new `move_to` or `input` (moveX/moveZ) from the client cancels any active server-driven path.

See also: `docs/PLAN-WORKFLOW-PATTERNS.md` Phase 5.
