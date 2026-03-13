/**
 * Claw state: types, initial state, pure helpers, and Zustand store.
 * One store per agent run (created in agent bootstrap); reads via getState(), writes via setState/actions.
 */

export {
  createInitialState,
  computeMainDocumentForBlock,
  isInConversationWithAgentInRoom,
  getFacingTowardNearestOccupant,
  type ClawState,
  type ChatEntry,
  type OwnerMessage,
  type BlockDocument,
  type Position3,
  type BuildTarget,
  type TickPhase,
} from "./state.js";
export { createClawStore, type ClawStore, type ClawStoreApi } from "./store.js";
