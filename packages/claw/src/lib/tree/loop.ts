/**
 * Single loop: Mistreevous behaviour tree stepped every 50ms.
 * @see docs/PLAN-AGENT-WAKE-DRIVEN.md §7
 */

import { BehaviourTree } from "mistreevous";
import { TREE_DEFINITION } from "./definition.js";
import { createTreeAgent, type TreeAgentContext } from "./agent.js";

const LOOP_INTERVAL_MS = 50;

/** Tree state from Mistreevous (e.g. "mistreevous.succeeded", "mistreevous.running"). */
export type TreeStateSnapshot = {
  /** Current tree-level state; RUNNING while an async action is in progress. */
  state: string;
};

/** Main agent loop: start/stop the 50ms tick; step() runs one tree tick (for tests). */
export type AgentLoop = {
  /** Start the interval; no-op if already running. */
  start(): void;
  /** Stop the interval. */
  stop(): void;
  /** Run one behaviour tree step (used by interval and tests). */
  step(): void;
  /** Current tree state (for debugging and tests). RUNNING when e.g. RunObedientAgent is in progress. */
  getTreeState(): TreeStateSnapshot;
};

/**
 * Create the main agent loop: one Mistreevous BehaviourTree stepped every 50ms.
 * Tree runs ExecuteMovementAndDrain then selector over wake branches (owner, autonomous, clear).
 *
 * @param ctx - Store, config, and optional runObedientAgent / runAutonomousAgent / executeMovementAndDrain
 * @returns Loop with start(), stop(), step()
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
    getTreeState(): TreeStateSnapshot {
      const state = (behaviourTree as { getState?: () => string }).getState?.() ?? "UNKNOWN";
      return { state };
    },
  };
}
