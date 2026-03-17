/**
 * Wire the behaviour tree loop with Obedient and Autonomous agents.
 * Pass a client to run real LLM agents; omit for a loop that only ticks the tree (stubs).
 */
import type { DoppelClient } from "@doppelfun/sdk";
import { buildSystemContent } from "./lib/prompts/index.js";
import { buildUserMessage } from "./lib/prompts/index.js";
import { runObedientAgentTick } from "./lib/agent/obedientAgent.js";
import { runAutonomousAgentTick } from "./lib/agent/autonomousAgent.js";
import { drainPendingReply } from "./lib/conversation.js";
import { movementDriverTick } from "./lib/movement/index.js";
import { reportUsageToHub, reportVoiceUsageToHub } from "./lib/credits/index.js";
import { createAgentLoop, type AgentLoop } from "./lib/tree/index.js";
import type { ClawStore } from "./lib/state/index.js";
import type { ClawConfig } from "./lib/config/index.js";
import { clawLog } from "./util/log.js";

/** Interval (ms) to refresh occupants so myPosition is set and TimeForAutonomousWake can fire when owner is away. */
const OCCUPANTS_REFRESH_MS = 10_000;

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
            const voiceId = config.voiceId ?? undefined;
            client.sendChat?.(result.replyText, {
              targetSessionId: dmTarget,
              voiceId,
            });
            if (voiceId && config.voiceEnabled) {
              reportVoiceUsageToHub(config, store, result.replyText.length, onUsageReportFailure);
            }
            store.setLastAgentChatMessage(result.replyText);
            store.setLastTickSentChat(true);
          }
          if (result.ok) store.clearOwnerMessages();
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
            const voiceId = config.voiceId ?? undefined;
            client.sendChat?.(result.replyText, {
              targetSessionId: dmTarget,
              voiceId,
            });
            if (voiceId && config.voiceEnabled) {
              reportVoiceUsageToHub(config, store, result.replyText.length, onUsageReportFailure);
            }
            store.setLastAgentChatMessage(result.replyText);
            store.setLastTickSentChat(true);
          }
          if (result.ok) store.clearOwnerMessages();
        }
      : undefined;

  const defaultExecuteMovementAndDrain = () => {
    if (!client) return;
    movementDriverTick(client, store, {
      voiceId: config.voiceId,
      onVoiceSent:
        config.voiceEnabled && config.voiceId
          ? (characters) => reportVoiceUsageToHub(config, store, characters, onUsageReportFailure)
          : undefined,
    });
    const pending = drainPendingReply(store);
    if (pending) {
      clawLog("runner: drain pending DM", pending.targetSessionId, pending.text.slice(0, 40));
      client.sendChat?.(pending.text, { targetSessionId: pending.targetSessionId });
    }
  };

  const loop = createAgentLoop({
    store,
    config,
    runObedientAgent,
    runAutonomousAgent,
    executeMovementAndDrain: executeMovementAndDrain ?? defaultExecuteMovementAndDrain,
  });

  const autonomousEnabled =
    client != null &&
    config.ownerUserId != null &&
    config.autonomousSoulTickMs > 0;

  if (!autonomousEnabled) {
    return loop;
  }

  let occupantsInterval: ReturnType<typeof setInterval> | null = null;

  const refreshOccupants = (): void => {
    if (!client) return;
    client.getOccupants().then(
      (occupants) => {
        const mySessionId = store.getState().mySessionId;
        store.setOccupants(occupants, mySessionId);
      },
      (err) => {
        clawLog("runner: occupants refresh failed", err instanceof Error ? err.message : String(err));
      }
    );
  };

  return {
    start() {
      if (occupantsInterval != null) return;
      refreshOccupants();
      occupantsInterval = setInterval(refreshOccupants, OCCUPANTS_REFRESH_MS);
      loop.start();
    },
    stop() {
      loop.stop();
      if (occupantsInterval != null) {
        clearInterval(occupantsInterval);
        occupantsInterval = null;
      }
    },
    step: loop.step.bind(loop),
  };
}
