/**
 * Movement: driver tick, autonomous manager, owner proximity.
 */
export {
  movementDriverTick,
  MOVEMENT_INPUT_INTERVAL_MS,
  DEFAULT_STOP_DISTANCE_M,
  type MovementDriverOptions,
} from "./movementDriver.js";
export { AutonomousManager } from "./autonomousManager.js";
export { isOwnerNearby } from "./ownerProximity.js";
