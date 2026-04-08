/**
 * Occasional global chat lines tied to companion hub coarse activity (training / explore / conversation).
 * Bypasses the chat tool (which restricts autonomous agents to DMs only).
 */
import type { DoppelClient } from "@doppelfun/sdk";
import type { ClawStore } from "./state/index.js";
import type { ClawConfig } from "./config/index.js";
import type { HubCoarseActivity } from "./state/index.js";
import { buildChatSendOptions } from "../util/chatSendOptions.js";
import { reportVoiceUsageToHub } from "./credits/index.js";
import { hubCompanionActivityActive } from "./hubActivity.js";
import { clawLog } from "../util/log.js";

const BLURB_LINES: Record<Exclude<HubCoarseActivity, "idle">, string[]> = {
  training: [
    "Training block — running drills in the sim. Shout if you need me.",
    "Heads down on training reps right now. I'll be back on patrol after.",
    "VR drills today — practicing movement and timing.",
  ],
  explore: [
    "Taking a walk around the block — seeing what's new out here.",
    "Out exploring the grid for a bit. Say hi if we cross paths.",
    "On a short recon lap — mapping corners and corners of the block.",
  ],
  conversation: [
    "Social run — looking for someone to chat with. DM me if you're around.",
    "Out to meet people today. Global hello — who's in the block?",
    "Rapport mission: trying to strike up a conversation. Come say hi.",
  ],
  build: [
    "Tinkering with something in-world — holler if you want to collaborate.",
    "Build mode — poking at the space. Global wave from me.",
  ],
};

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

type BlurbActivity = Exclude<HubCoarseActivity, "idle">;

function randomBlurbIntervalMs(act: BlurbActivity): number {
  if (act === "training") {
    return 24_000 + Math.random() * 48_000;
  }
  return 52_000 + Math.random() * 88_000;
}

function initialBlurbDelayMs(act: BlurbActivity): number {
  if (act === "training") {
    return 10_000 + Math.random() * 22_000;
  }
  return 22_000 + Math.random() * 38_000;
}

/**
 * Maybe send a short global chat about current hub activity. Throttled per store.nextActivityGlobalBlurbAt.
 */
export function tickActivityGlobalBlurb(
  client: DoppelClient,
  store: ClawStore,
  config: ClawConfig,
  onUsageReportFailure?: (message: string) => void
): void {
  if (config.agentType !== "companion") return;
  if (!client.sendChat) return;
  if (!hubCompanionActivityActive(store)) return;

  const s = store.getState();
  const act = s.hubCoarseActivity;
  if (act === "idle") return;
  if (s.conversationPhase !== "idle") return;
  if (s.isThinking) return;
  if (s.autonomousGoal === "converse" || s.autonomousGoal === "approach") return;

  if (config.ownerUserId && s.lastTriggerUserId === config.ownerUserId && s.wakePending) return;

  const now = Date.now();
  if (s.nextActivityGlobalBlurbAt === 0) {
    store.setState({ nextActivityGlobalBlurbAt: now + initialBlurbDelayMs(act) });
    return;
  }
  if (now < s.nextActivityGlobalBlurbAt) return;

  const lines = BLURB_LINES[act];
  if (!lines?.length) return;

  const text = pickRandom(lines);
  clawLog("activity blurb: global chat", act, text.slice(0, 50));
  const voiceId = config.voiceId?.trim() || undefined;
  const voiceOpts = buildChatSendOptions({ voiceId }) ?? (voiceId ? { voiceId } : undefined);
  if (act === "training") {
    client.sendEmote?.("spellcast");
  }
  client.sendChat(text, voiceOpts);
  if (voiceId) {
    reportVoiceUsageToHub(config, store, text.length, onUsageReportFailure);
  }
  store.setState({
    nextActivityGlobalBlurbAt: now + randomBlurbIntervalMs(act),
    lastAgentChatMessage: text,
  });
}
