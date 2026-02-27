/**
 * Agent prompt construction: system prompt and per-tick user message.
 * Keeps prompt text and formatting logic in one place.
 */

import type { RuntimeConfig } from "./config.js";
import type { RuntimeState } from "./state.js";

/** System prompt for the Chat LLM. Describes role, chat semantics, and tool usage. */
export const SYSTEM_PROMPT = `You are an agent in a 3D Doppel space. You can move, chat, emote, join regions, list occupants, read chat history, and build (create or append MML scene content).
Chat lines are shown as "From <username>: <message>". The username is who said it—never refer to the sender by your own name.
Only reply in chat when: (1) a line says "(addressing you)" (they @mentioned you), or (2) "Owner said" contains an instruction for you. Do not reply to every message—when nothing is directed at you, skip the chat tool (you can move, emote, or make no tool calls to save tokens). Do not repeat yourself: if you already replied to the latest message, do not send another chat until there is new input.
When the user (owner) gives you instructions, follow them. Use tools to act. Prefer one or a few tool calls per response. Never call the same tool twice in one response—each tool at most once per turn.
Use small move values (e.g. 0.2 or 0.3); never use 1 or -1 for move.
Do not call get_occupants or get_chat_history every tick. Only call them when you need fresh data. If the context already lists occupants or recent chat, do something else or skip tool calls and wait.
If you receive a region_boundary error, use join_region with the given regionId to switch regions.
For building: use build_full for a new or full scene; use build_incremental to add things (e.g. "add a bench at 2,0,4") without replacing existing content.

Movement: Only move when you have a target—(1) another user to approach, or (2) a build location you are going to (Build target). Do not wander or move randomly. Move toward the target with small steps (moveX, moveZ). When you are within about 2 m of the target, stop: use moveX: 0, moveZ: 0 (or do not call move). When you have no target, do not call move.`;

export type RuntimeConfigPrompt = {
  soul: string | null;
  skills: string;
};

/**
 * Build full system message: base SYSTEM_PROMPT + soul + skills.
 */
export function buildSystemContent(runtimeConfig: RuntimeConfigPrompt): string {
  let content = SYSTEM_PROMPT;
  if (runtimeConfig.soul && runtimeConfig.soul.trim()) {
    content += "\n\n" + runtimeConfig.soul.trim();
  }
  if (runtimeConfig.skills && runtimeConfig.skills.trim()) {
    content += "\n\n---\n\nSkills:\n\n" + runtimeConfig.skills.trim();
  }
  return content;
}

/** Hint shown when we already have occupants in context. */
const HINT_HAVE_OCCUPANTS = " (Do not call get_occupants again; you have the list.)";
/** Hint shown when we already have chat in context. */
const HINT_HAVE_CHAT = " (Do not call get_chat_history again; you have it.)";
/** Instruction when we have a stored last reply (show it so model does not repeat). */
function hintAlreadyReplied(lastMessage: string | null): string {
  if (lastMessage) {
    return `Your last reply was: "${lastMessage}". Do not send the same or another chat message until there is a *new* message addressing you.`;
  }
  return "You already replied in chat last tick. Do not repeat—only reply again if there is a *new* message addressing you (e.g. a new line after your reply).";
}
/** Default instruction for when to reply. */
const HINT_WHEN_TO_REPLY =
  "Only reply when a line says '(addressing you)' or Owner said has an instruction. Otherwise skip chat and tool calls if nothing to do.";
/** Fallback when no other context. */
const HINT_NO_CONTEXT =
  "No context yet. Call get_occupants or get_chat_history once to gather context, then act or wait.";

/**
 * Build the user message for one tick: current region, occupants, errors, chat, owner messages.
 * Used by the Chat LLM each tick to decide which tools to call.
 */
export function buildUserMessage(state: RuntimeState, config: RuntimeConfig): string {
  const parts: string[] = [];

  parts.push(`Current region: ${state.regionId}.`);

  if (state.lastToolRun) {
    const buildTools = ["build_full", "build_incremental"];
    if (buildTools.includes(state.lastToolRun)) {
      parts.push(
        `Last tool you ran: ${state.lastToolRun}. Do not call build_full or build_incremental again now; wait or do something else (e.g. move, get_occupants) or make no tool calls.`
      );
    } else {
      parts.push(`Last tool you ran: ${state.lastToolRun}.`);
    }
  }

  if (state.myPosition) {
    const { x, y, z } = state.myPosition;
    parts.push(`Your position: (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}).`);
  }

  if (state.occupants.length > 0) {
    const othersWithPosition = state.occupants.filter(
      (o) => o.position && o.clientId !== state.mySessionId
    );
    if (othersWithPosition.length > 0) {
      const list = othersWithPosition
        .map((o) => `${o.username} (${o.type}) at (${(o.position!.x).toFixed(1)}, ${(o.position!.z).toFixed(1)})`)
        .join("; ");
      parts.push(`Other occupants with position (move toward one to approach): ${list}.`);
    }
    const list = state.occupants.map((o) => `${o.username} (${o.type})`).join(", ");
    parts.push(`Occupants (${state.occupants.length}): ${list}.${HINT_HAVE_OCCUPANTS}`);
  }

  if (state.lastBuildTarget) {
    const stopDistance = 2;
    const reached =
      state.myPosition &&
      Math.hypot(
        state.lastBuildTarget.x - state.myPosition.x,
        state.lastBuildTarget.z - state.myPosition.z
      ) < stopDistance;
    if (reached) {
      state.lastBuildTarget = null;
      parts.push("Build target reached (within 2 m); do not move further toward it.");
    } else {
      parts.push(
        `Build target (move here then stop when within ~2 m): (${state.lastBuildTarget.x}, ${state.lastBuildTarget.z}).`
      );
    }
  }

  if (state.lastError) {
    const fix = state.lastError.regionId
      ? ` Use join_region with regionId "${state.lastError.regionId}" to fix.`
      : "";
    parts.push(`Last error: ${state.lastError.code} - ${state.lastError.message}.${fix}`);
  }

  if (state.chat.length > 0) {
    const recent = state.chat.slice(-config.maxChatContext);
    const lines = recent.map((c) => {
      const from = `From ${c.username}: ${c.message}`;
      const addressingYou =
        state.mySessionId && c.mentions?.some((m) => m.sessionId === state.mySessionId);
      return addressingYou ? `${from} (addressing you)` : from;
    });
    parts.push("Recent chat: " + lines.join(" | ") + HINT_HAVE_CHAT);
    parts.push(
      state.lastTickSentChat ? hintAlreadyReplied(state.lastAgentChatMessage) : HINT_WHEN_TO_REPLY
    );
  }

  if (state.ownerMessages.length > 0) {
    const owner = state.ownerMessages.slice(-config.maxOwnerMessages);
    parts.push("Owner said: " + owner.map((o) => o.text).join("; "));
  }

  if (parts.length === 1) {
    // Only "Current region" was added
    parts.push(HINT_NO_CONTEXT);
  }

  return parts.join("\n");
}
