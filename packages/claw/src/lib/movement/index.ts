/**
 * Movement: driver tick (apply intent / check arrival), owner proximity check.
 */
export { isOwnerNearby } from "./ownerProximity.js";
export {
  movementDriverTick,
  MOVEMENT_INPUT_INTERVAL_MS,
  DEFAULT_STOP_DISTANCE_M,
  type MovementDriverOptions,
} from "./movementDriver.js";
