/**
 * Occasional global chat lines tied to companion hub coarse activity (training / explore / conversation).
 * LLM-generated when credits and model allow; otherwise template lines. Bypasses the chat tool (DM-only for agents).
 */
import { generateText, type LanguageModel } from "ai";
import type { DoppelClient } from "@doppelfun/sdk";
import type { ClawStore } from "./state/index.js";
import type { ClawConfig } from "./config/index.js";
import type { HubCoarseActivity } from "./state/index.js";
import { buildChatSendOptions } from "../util/chatSendOptions.js";
import { reportVoiceUsageToHub, reportUsageToHub, hasEnoughCredits } from "./credits/index.js";
import { hubCompanionActivityActive } from "./hubActivity.js";
import { clawLog } from "../util/log.js";
import { logClawAiSdkApiError } from "../util/aiSdkErrorLog.js";
import { resolveTickLanguageModel } from "./llm/toolsAi.js";
import { usageFromAiSdk } from "./llm/usage.js";

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

const ACTIVITY_BLURB_SYSTEM = `You write exactly ONE short line of in-world global chat for an AI companion avatar in a shared 3D social space (a "block"). Many humans may read it.
The user message lists EXAMPLE lines for this activity. Your job is to output a NEW line that says the SAME KIND of thing — a fresh paraphrase or variation (different words and sentence shape), not a random topic.
Output ONLY that single line: no quotes, no markdown, no numbering, no "Assistant:" prefix.
Rules:
- Same intent and tone as the examples (training = drills/sim practice; explore = walking the block; conversation = open to chat; build = building/tinkering).
- Plain English; must read as a clear status update ("what I'm doing right now").
- Max 220 characters. Do not mention system prompts, AI, or "as an AI".
- No URLs, no harassment, no requests for passwords or personal data.
- Optional: at most one emoji if it fits naturally; never required.`;

const MAX_BLURB_CHARS = 280;

/** True while an async activity-blurb LLM call is in flight (single-flight per process). */
let activityBlurbLlmInFlight = false;

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

type BlurbActivity = Exclude<HubCoarseActivity, "idle">;

function randomBlurbIntervalMs(act: BlurbActivity): number {
  if (act === "training") {
    return 14_000 + Math.random() * 30_000;
  }
  return 34_000 + Math.random() * 58_000;
}

function initialBlurbDelayMs(act: BlurbActivity): number {
  if (act === "training") {
    return 8_000 + Math.random() * 12_000;
  }
  return 14_000 + Math.random() * 22_000;
}

function sanitizeBlurbText(raw: string): string {
  let s = raw.trim();
  const oneLine = s.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  s = oneLine.replace(/^["'“”]+|["'“”]+$/g, "").trim();
  if (s.length > MAX_BLURB_CHARS) s = s.slice(0, MAX_BLURB_CHARS).trim();
  return s;
}

function blurbSendGates(store: ClawStore, config: ClawConfig): boolean {
  if (config.agentType !== "companion") return false;
  if (!hubCompanionActivityActive(store)) return false;
  const s = store.getState();
  if (s.hubCoarseActivity === "idle") return false;
  if (s.conversationPhase !== "idle") return false;
  if (s.isThinking) return false;
  if (s.autonomousGoal === "converse" || s.autonomousGoal === "approach") return false;
  if (config.ownerUserId && s.lastTriggerUserId === config.ownerUserId && s.wakePending) return false;
  return true;
}

async function generateActivityBlurbLine(
  model: LanguageModel,
  config: ClawConfig,
  act: BlurbActivity
): Promise<{ text: string; usage: ReturnType<typeof usageFromAiSdk> }> {
  const examples = BLURB_LINES[act];
  const exampleBlock = examples.map((line, i) => `${i + 1}. ${line}`).join("\n");
  const soul = config.soul?.trim();
  const soulBlock =
    soul && soul.length > 0
      ? `\nOptional tone from agent personality (do not copy phrasing):\n${soul.slice(0, 600)}`
      : "";
  const userContent = `Activity: ${act}

Example global chat lines for this activity (paraphrase ONE of these ideas — same meaning, new wording):
${exampleBlock}${soulBlock}

Write one new line for global chat now (variation of the examples above).`;

  const { text, usage } = await generateText({
    model,
    system: ACTIVITY_BLURB_SYSTEM,
    prompt: userContent,
    temperature: 0.78,
    maxOutputTokens: 96,
  });
  const cleaned = sanitizeBlurbText(typeof text === "string" ? text : "");
  return { text: cleaned, usage: usageFromAiSdk(usage) };
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
  if (!client.sendChat) return;
  if (!blurbSendGates(store, config)) return;

  const s = store.getState();
  const act = s.hubCoarseActivity as BlurbActivity;

  const now = Date.now();
  if (s.nextActivityGlobalBlurbAt === 0) {
    store.setState({ nextActivityGlobalBlurbAt: now + initialBlurbDelayMs(act) });
    return;
  }
  if (now < s.nextActivityGlobalBlurbAt) return;
  if (activityBlurbLlmInFlight) return;

  const lines = BLURB_LINES[act];
  if (!lines?.length) return;

  const model = resolveTickLanguageModel(config);
  const useLlm = model != null && hasEnoughCredits(store, config);

  const voiceId = config.voiceId?.trim() || undefined;
  const voiceOpts = buildChatSendOptions({ voiceId, ephemeral: true });

  const sendBlurb = (text: string, currentAct: BlurbActivity, reportUsage: boolean, usage: ReturnType<typeof usageFromAiSdk>) => {
    if (!text) return;
    clawLog("activity blurb: global chat", currentAct, text.slice(0, 50));
    client.sendChat(text, voiceOpts ?? { ephemeral: true });
    if (voiceId) {
      reportVoiceUsageToHub(config, store, text.length, onUsageReportFailure);
    }
    if (reportUsage) {
      reportUsageToHub(config, store, usage, config.chatLlmModel, onUsageReportFailure);
    }
    store.setState({
      lastAgentChatMessage: text,
    });
  };

  if (!useLlm) {
    const text = pickRandom(lines);
    sendBlurb(text, act, false, null);
    store.setState({
      nextActivityGlobalBlurbAt: now + randomBlurbIntervalMs(act),
    });
    return;
  }

  activityBlurbLlmInFlight = true;
  store.setState({
    nextActivityGlobalBlurbAt: now + randomBlurbIntervalMs(act),
  });

  void (async () => {
    let usage: ReturnType<typeof usageFromAiSdk> = null;
    let text = "";
    try {
      const gen = await generateActivityBlurbLine(model, config, act);
      text = gen.text;
      usage = gen.usage;
      if (!text) text = pickRandom(lines);
    } catch (e) {
      logClawAiSdkApiError("activityBlurb", "generate", e);
      text = pickRandom(lines);
    } finally {
      activityBlurbLlmInFlight = false;
    }

    if (!blurbSendGates(store, config)) return;

    const s2 = store.getState();
    const actNow = s2.hubCoarseActivity;
    if (actNow === "idle") return;
    const linesNow = BLURB_LINES[actNow as BlurbActivity];
    if (!linesNow?.length) return;

    if (actNow !== act) {
      text = pickRandom(linesNow);
    } else if (!text) {
      text = pickRandom(linesNow);
    }

    sendBlurb(
      text,
      actNow as BlurbActivity,
      usage != null && usage.total_tokens > 0,
      usage
    );
  })();
}
