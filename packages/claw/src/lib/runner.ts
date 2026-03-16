/**
 * Wire the behaviour tree loop with Obedient and Autonomous agents.
 * Pass a client to run real LLM agents; omit for a loop that only ticks the tree (stubs).
 */
import type { DoppelClient } from "@doppelfun/sdk";
import { buildSystemContent } from "./prompts/index.js";
import { buildUserMessage } from "./prompts/index.js";
import { runObedientAgentTick } from "./agent/obedientAgent.js";
import { runAutonomousAgentTick } from "./agent/autonomousAgent.js";
import { drainPendingReply } from "./conversation.js";
import { movementDriverTick } from "./movement/index.js";
import { reportUsageToHub } from "./credits/index.js";
import { createAgentLoop, type AgentLoop } from "./tree/index.js";
import type { ClawStore } from "./state/index.js";
import type { ClawConfig } from "./config/index.js";
import { clawLog } from "./log.js";

/** Options for creating the runner (store, config, optional client and callbacks). */
export type RunnerOptions = {
  store: ClawStore;
  config: ClawConfig;
  /** When provided, Obedient and Autonomous agents run real LLM ticks. When omitted, they are no-ops. */
  client?: DoppelClient | null;
  /** Optional: called every 50ms for movement and draining pending DM. Requires client. */
  executeMovementAndDrain?: () => void;
  /** Optional: called when report-usage fails (e.g. 402 insufficient credits). */
  onUsageReportFailure?: (message: string) => void;
};

/**
 * Create the main agent loop with Obedient and Autonomous agents wired to the behaviour tree.
 * Builds system content once; on each wake runs buildUserMessage, then the appropriate agent tick.
 * Sends fallback chat to DM peer when the agent used tools but did not send chat.
 *
 * @param options - Store, config, optional client, executeMovementAndDrain, onUsageReportFailure
 * @returns AgentLoop (start/stop/step) from createAgentLoop
 */
export function createRunner(options: RunnerOptions): AgentLoop {
  const { store, config, client, executeMovementAndDrain, onUsageReportFailure } = options;
  const clawConfigPrompt = { soul: config.soul ?? undefined, skills: undefined };
  const systemContent = buildSystemContent(clawConfigPrompt);

  const runObedientAgent =
    client != null
      ? async () => {
          clawLog("runner: RunObedientAgent start");
          const userContent = buildUserMessage(store, config);
          const result = await runObedientAgentTick(client, store, config, systemContent, userContent);
          const state = store.getState();
          clawLog("runner: obedient tick done", "ok=" + result.ok, "replyText=" + (result.ok && result.replyText ? result.replyText.slice(0, 60) + "…" : "null"), "lastTickSentChat=" + state.lastTickSentChat);
          if (result.ok && result.usage) {
            reportUsageToHub(config, store, result.usage, config.chatLlmModel, onUsageReportFailure);
          }
          if (result.ok && result.replyText && !state.lastTickSentChat) {
            clawLog("runner: sending fallback chat", result.replyText.slice(0, 80));
            const dmTarget = state.lastDmPeerSessionId ?? undefined;
            client.sendChat?.(result.replyText, {
              targetSessionId: dmTarget,
              voiceId: config.voiceId ?? undefined,
            });
            store.setLastAgentChatMessage(result.replyText);
            store.setLastTickSentChat(true);
          }
        }
      : undefined;

  const runAutonomousAgent =
    client != null
      ? async () => {
          clawLog("runner: RunAutonomousAgent start");
          const userContent = buildUserMessage(store, config);
          const result = await runAutonomousAgentTick(client, store, config, systemContent, userContent);
          const state = store.getState();
          clawLog("runner: autonomous tick done", "ok=" + result.ok, "replyText=" + (result.ok && result.replyText ? result.replyText.slice(0, 60) + "…" : "null"), "lastTickSentChat=" + state.lastTickSentChat);
          if (result.ok && result.usage) {
            reportUsageToHub(config, store, result.usage, config.chatLlmModel, onUsageReportFailure);
          }
          if (result.ok && result.replyText && !state.lastTickSentChat) {
            clawLog("runner: sending fallback chat", result.replyText.slice(0, 80));
            const dmTarget = state.lastDmPeerSessionId ?? undefined;
            client.sendChat?.(result.replyText, {
              targetSessionId: dmTarget,
              voiceId: config.voiceId ?? undefined,
            });
            store.setLastAgentChatMessage(result.replyText);
            store.setLastTickSentChat(true);
          }
        }
      : undefined;

  const defaultExecuteMovementAndDrain = () => {
    if (!client) return;
    movementDriverTick(client, store, { voiceId: config.voiceId });
    const pending = drainPendingReply(store);
    if (pending) {
      clawLog("runner: drain pending DM", pending.targetSessionId, pending.text.slice(0, 40));
      client.sendChat?.(pending.text, { targetSessionId: pending.targetSessionId });
    }
  };

  return createAgentLoop({
    store,
    config,
    runObedientAgent,
    runAutonomousAgent,
    executeMovementAndDrain: executeMovementAndDrain ?? defaultExecuteMovementAndDrain,
  });
}
