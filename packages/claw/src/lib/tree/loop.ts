/**
 * Single loop: Mistreevous behaviour tree stepped every 50ms.
 * @see docs/PLAN-AGENT-WAKE-DRIVEN.md §7
 */

import { BehaviourTree } from "mistreevous";
import { TREE_DEFINITION } from "./definition.js";
import { createTreeAgent, type TreeAgentContext } from "./agent.js";

const LOOP_INTERVAL_MS = 50;

export type AgentLoop = {
  start(): void;
  stop(): void;
  step(): void;
};

/**
 * Create the main agent loop: one BehaviourTree stepped every 50ms.
 * Pass context with store, config, and optional runObedientAgent/runAutonomousAgent/executeMovementAndDrain.
 */
export function createAgentLoop(ctx: TreeAgentContext): AgentLoop {
  const agent = createTreeAgent(ctx);
  const behaviourTree = new BehaviourTree(TREE_DEFINITION, agent);

  let intervalId: ReturnType<typeof setInterval> | null = null;

  function step(): void {
    behaviourTree.step();
  }

  return {
    start() {
      if (intervalId != null) return;
      intervalId = setInterval(step, LOOP_INTERVAL_MS);
    },
    stop() {
      if (intervalId != null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
    step,
  };
}
