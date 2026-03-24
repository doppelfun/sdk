/**
 * Movement: driver tick (apply intent / check arrival), owner proximity check.
 */
export { isOwnerNearby } from "./ownerProximity.js";
export {
  AUTONOMOUS_MOVE_COOLDOWN_MS,
  SOCIAL_SEEK_COOLDOWN_MS,
  MOVE_RETRY_DELAY_MS,
  randomAutonomousMoveCooldownMs,
} from "./autonomousCooldown.js";
export {
  movementDriverTick,
  MOVEMENT_INPUT_INTERVAL_MS,
  DEFAULT_STOP_DISTANCE_M,
  CONVERSATION_RANGE_M,
  type MovementDriverOptions,
} from "./movementDriver.js";
