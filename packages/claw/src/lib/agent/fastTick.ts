/**
 * 50 ms fast-tick loop: handler type and factory. Run between main tick loop iterations
 * for movement, conversation checks, and draining pending DM. Add new behaviors by
 * appending handlers to the list returned by createFastTickHandlers.
 */

import type { ClawStore } from "../state/index.js";
import type { ClawConfig } from "../config/index.js";
import { checkBreak, CONVERSATION_MAX_ROUNDS, drainPendingReply } from "../conversation/index.js";
import { sendDmAndTransition } from "./tickRunner.js";
import { movementDriverTick, AutonomousManager } from "../movement/index.js";

export type FastTickContext = {
  client: Parameters<typeof movementDriverTick>[0];
  store: ClawStore;
  config: ClawConfig;
  /** Timestamp for this tick (shared so handlers don't each call Date.now()). */
  now: number;
};

export type FastTickHandler = (ctx: FastTickContext) => void;

/**
 * Build options for checkBreak from context. Shared so the 50ms loop passes one state snapshot.
 */
function getCheckBreakOptions(ctx: FastTickContext) {
  const state = ctx.store.getState();
  return {
    occupants: state.occupants,
    ownerUserId: ctx.config.ownerUserId,
    lastTriggerUserId: state.lastTriggerUserId,
    maxRounds: CONVERSATION_MAX_ROUNDS,
  };
}

/**
 * Create the list of handlers for the 50 ms loop. Call with the same autonomousManager
 * instance used by the agent so state stays consistent. Order: conversation break →
 * autonomous movement/emote → movement driver → drain pending DM.
 */
export function createFastTickHandlers(
  autonomousManager: AutonomousManager
): FastTickHandler[] {
  return [
    (ctx) => checkBreak(ctx.store, ctx.now, getCheckBreakOptions(ctx)),
    (ctx) => autonomousManager.tick(ctx.client, ctx.store, ctx.config),
    (ctx) => movementDriverTick(ctx.client, ctx.store, { voiceId: ctx.config.voiceId }),
    (ctx) => {
      const pending = drainPendingReply(ctx.store);
      if (pending) {
        sendDmAndTransition(
          ctx.client,
          ctx.store,
          pending.text,
          pending.targetSessionId,
          ctx.config.voiceId
        );
      }
    },
  ];
}
