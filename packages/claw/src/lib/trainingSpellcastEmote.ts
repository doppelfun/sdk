/**
 * While hub coarse activity is training, repeat the spellcast emote on an interval unless the agent is busy.
 * Intentionally does NOT block on movement — companions often wander during training; emotes should still show.
 * Engine clears emote state after ~3s; interval must stay above that so "spellcast" can replay (see BlockRoom emote handler).
 */
import type { DoppelClient } from "@doppelfun/sdk";
import type { ClawStore } from "./state/index.js";
import type { ClawConfig } from "./config/index.js";
import { hubCompanionActivityActive } from "./hubActivity.js";
import { clawLog } from "../util/log.js";

const SPELLCAST_INTERVAL_MS = 5_000;

/**
 * While training: send spellcast emote every {@link SPELLCAST_INTERVAL_MS} when not in LLM/DM/social navigation.
 */
export function tickTrainingSpellcastEmote(client: DoppelClient, store: ClawStore, config: ClawConfig): void {
  if (config.agentType !== "companion") return;
  if (!client.sendEmote) return;

  const s = store.getState();

  if (!hubCompanionActivityActive(store) || s.hubCoarseActivity !== "training") {
    if (s.nextTrainingSpellcastEmoteAt !== 0) {
      store.setState({ nextTrainingSpellcastEmoteAt: 0 });
    }
    return;
  }

  if (s.conversationPhase !== "idle") return;
  if (s.isThinking) return;
  if (s.autonomousGoal === "converse" || s.autonomousGoal === "approach") return;
  if (config.ownerUserId && s.lastTriggerUserId === config.ownerUserId && s.wakePending) return;
  if (s.pendingDmReply) return;

  const now = Date.now();
  const nextAt = s.nextTrainingSpellcastEmoteAt;
  if (nextAt !== 0 && now < nextAt) return;

  client.sendEmote("spellcast");
  clawLog("training: spellcast emote");
  store.setState({ nextTrainingSpellcastEmoteAt: now + SPELLCAST_INTERVAL_MS });
}
