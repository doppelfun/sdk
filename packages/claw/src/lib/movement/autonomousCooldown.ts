/**
 * Shared timing for autonomous navigation: wander legs, social seek spacing, retries after failures.
 * Kept in one module so runner (tree actions) and movementDriver stay aligned.
 */

/** Cooldown (ms) after starting a move leg or seek before the next autonomous move-to / wander pick. */
export const AUTONOMOUS_MOVE_COOLDOWN_MS = { min: 20_000, max: 45_000 } as const;

/** Cooldown (ms) after SeekSocialTarget before ShouldSeekSocialTarget can pass again. */
export const SOCIAL_SEEK_COOLDOWN_MS = 10_000;

/** After move_to failure or stuck movement timeout, wait this long before picking a new wander target. */
export const MOVE_RETRY_DELAY_MS = 2000;

export function randomAutonomousMoveCooldownMs(): number {
  const { min, max } = AUTONOMOUS_MOVE_COOLDOWN_MS;
  return min + Math.random() * (max - min);
}
