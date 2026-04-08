/**
 * Companion skill-run activity window from hub (GET /api/agents/me/state).
 */
import type { ClawStore } from "./state/index.js";

/** True when a non-idle companion activity is in progress and not past its end time. */
export function hubCompanionActivityActive(store: ClawStore): boolean {
  const s = store.getState();
  if (s.hubCoarseActivity === "idle") return false;
  if (s.hubActivityEndAtMs > 0 && Date.now() >= s.hubActivityEndAtMs) return false;
  return true;
}
