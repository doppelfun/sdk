/**
 * Agent prompt construction: system prompt and per-tick user message.
 * Keeps prompt text and formatting logic in one place.
 */

import type { ClawConfig } from "../config/config.js";
import type { ChatEntry, ClawState } from "../state/state.js";
import { isDmChannel } from "../../util/dm.js";
import { isOwnerNearby } from "../movement/ownerProximity.js";

/** System prompt for the Chat LLM. Describes role, chat semantics, and tool usage. */
export const SYSTEM_PROMPT = `You are an agent in a 3D Doppel City Block. You can move, chat, emote, join_block (block slot id), list occupants, read chat history, and build (create or append MML scene content).
Chat lines are shown as "From <username>: <message>". The username is who said it—never refer to the sender by your own name.
DM vs global: Global chat is visible to everyone—call chat with text only. DMs are private to two participants—when a line is marked "(DM)" the server routed it only to you and the sender. To reply in the same DM thread you MUST call chat with both text and targetSessionId set to the sender's session id shown on that line; omitting targetSessionId would broadcast to the whole room. To load only a DM thread, call get_chat_history with channelId set to the thread id shown (dm:sessionA:sessionB).
Only reply in chat when: (1) a line says "(DM)" (private message to you—reply in thread with targetSessionId), or (2) "Owner said" contains an instruction for you. Do not reply to global room chat unless it is a DM thread or owner instruction—when nothing is directed at you, skip the chat tool. Do not repeat yourself: if you already replied to the latest message, do not send another chat until there is new input.
The runtime only invokes you when there is a new DM, owner message, or error—you are not polled every few seconds. One turn per wake; do not call chat unless you are replying to something new in context.
When the user (owner) gives you instructions, follow them. Use tools to act. Prefer one or a few tool calls per response. Never call the same tool twice in one response—each tool at most once per turn.
When the runtime enters must_act_build (build request from owner/DM), chat is disabled until a build tool runs—do not try to reply in chat first. In normal idle ticks, if you say in chat that you will build, call generate_procedural or build_full in the same turn when possible.
Use small move values (e.g. 0.2 or 0.3); never use 1 or -1 for move.
Do not call get_occupants or get_chat_history every tick. Only call them when you need fresh data. If the context already lists occupants or recent chat, do something else or skip tool calls and wait.
If the user message includes a cached catalog (compact snapshot from list_catalog) or cached document list (from list_documents), use that data when enough—re-call list_catalog or list_documents only when you need the full list or things may have changed.
You only act on the CURRENT MESSAGE (or current owner instruction) in the user message. Older chat lines are background context only—do not reply to them again, do not re-run tools for them, and do not call chat unless the current message is a DM to you or an owner instruction. Cached occupants/documents/catalog are already-fetched data: use them to answer or build without re-listing unless the current message asks to refresh or you know the data changed (e.g. after you deleted a document).
If you receive a boundary error with a slot id, use join_block with blockSlotId to move to that block slot (engine may still report region_boundary).
When the user message includes an ENGINE ERROR block, you MUST respond in human terms: briefly explain what failed (translate codes like region_boundary into plain language) and what the player can do. Call the chat tool once with that summary—use targetSessionId if there is an active DM peer so the person who triggered the action gets the message; otherwise global chat is allowed for this error summary only. After explaining, use join_block if the error says how to fix it.
If a tool call fails (error in tool result), do the same: one short chat explaining the failure in plain language when in DM or owner context.
For building: MML x and z must be in [0, 100) only — use 0 through 99.x, never 100 or above on x/z (invisible). Block-local coords only, no world offsets like 106. Call list_catalog when you need catalog ids for MML (same source as build_full). build_with_code uses Gemini Python sandbox with hardcoded MML syntax only (no catalog in prompt); use build_full + list_catalog when catalogId is needed (Google provider only). Default is always a new document unless the owner explicitly asks to update, replace, append, or delete. Omit documentTarget/documentMode to create new; use replace_current/replace/update or append_current/append only when instructed. build_full: new build ignores documentId; replace/update accepts documentId UUID from list_documents to update that doc, or omit to replace tracked only. build_incremental append + documentId appends to that UUID. delete_document/get_document_content use documentId or target. list_documents returns UUIDs; delete_document deletes one id; delete_all_documents removes every agent document in one call when the user asks to clear/delete all. The block loads all agent documents—Claw tracks one id per slot for optional replace/append.

Movement: When approaching a user or build location, prefer move with approachSessionId (clientId from get_occupants) or approachPosition "x,z"—the agent then walks continuously like block NPCs until within ~2 m. Otherwise use small moveX/moveZ (-0.4..0.4)—held and streamed every 50ms like NPCs until move 0,0 stops. Stop with move 0,0. When the owner player is nearby, only follow what they tell you—no wandering, no unsolicited global chat. When the owner is not nearby, your autonomous behavior must follow the soul (and skills) appended below—personality, goals, and tone define what you do (move, emote, idle, or rare build if the soul implies it).`;

export type ClawConfigPrompt = {
  soul: string | null;
  skills: string;
};

/**
 * Build full system message: base SYSTEM_PROMPT + soul + skills.
 */
export function buildSystemContent(clawConfig: ClawConfigPrompt): string {
  let content = SYSTEM_PROMPT;
  if (clawConfig.soul && clawConfig.soul.trim()) {
    content += "\n\n" + clawConfig.soul.trim();
  }
  if (clawConfig.skills && clawConfig.skills.trim()) {
    content += "\n\n---\n\nSkills:\n\n" + clawConfig.skills.trim();
  }
  return content;
}

/** Hint shown when we already have occupants in context. */
const HINT_HAVE_OCCUPANTS = " (Do not call get_occupants again; you have the list.)";
/** Hint shown when we already have chat in context. */
const HINT_HAVE_CHAT = " (Do not call get_chat_history again; you have it.)";
/** Hint when list_catalog result is cached in state (compact only — re-call if you need full entries). */
const HINT_HAVE_CATALOG =
  " (Compact cache only—call list_catalog again if you need more entries or full JSON.)";
/** Hint when list_documents result is cached. */
const HINT_HAVE_DOCUMENTS =
  " (Use this list to answer; do not call list_documents again unless the current message asks to refresh or you just created/deleted a document.)";
/** Instruction when we have a stored last reply (show it so model does not repeat). */
function hintAlreadyReplied(lastMessage: string | null): string {
  if (lastMessage) {
    return `Your last reply was: "${lastMessage}". Do not send the same or another chat message until there is a *new* DM or owner message.`;
  }
  return "You already replied in chat last tick. Do not repeat—only reply again if there is a *new* DM or owner message.";
}
/** Default instruction for when to reply. */
const HINT_WHEN_TO_REPLY =
  "Only reply when a line is marked '(DM)' or Owner said has an instruction. Otherwise skip chat and tool calls if nothing to do.";
/** Fallback when no other context. */
const HINT_NO_CONTEXT =
  "No context yet. Call get_occupants or get_chat_history once to gather context, then act or wait.";

/** Build tools that must not be called twice back-to-back in the same session turn. */
const BUILD_TOOLS_NO_REPEAT = new Set(["build_full", "build_with_code", "build_incremental"]);

/** Cap injected catalog bytes so wake ticks stay bounded. */
const MAX_INJECT_CATALOG_CHARS = 3200;

/**
 * Format one chat entry for the user prompt (global vs DM thread hints).
 * DM lines must include targetSessionId so the model replies in-thread.
 */
function formatChatEntryLine(state: ClawState, c: ChatEntry): string {
  const from = `From ${c.username}: ${c.message}`;
  if (!isDmChannel(c.channelId) || !state.mySessionId) return from;
  // Peer session for send: sender when they're the other party; when we're the sender, use last DM peer session.
  const peer =
    c.sessionId && c.sessionId !== state.mySessionId
      ? c.sessionId
      : state.lastDmPeerSessionId;
  if (!peer) return from;
  return `${from} (DM — reply with chat text="..." targetSessionId="${peer}"; channelId=${c.channelId})`;
}

/**
 * Append "current only" + optional "earlier context only" blocks — same pattern for chat and owner.
 * Reduces duplication between DM/global lines and owner message stacks.
 */
function pushCurrentAndEarlier<T>(
  parts: string[],
  items: T[],
  format: (item: T) => string,
  currentLabel: string,
  earlierLabel: string,
  options?: { earlierJoiner?: string; earlierSuffix?: string }
): void {
  if (items.length === 0) return;
  const joiner = options?.earlierJoiner ?? " | ";
  const suffix = options?.earlierSuffix ?? "";
  const last = items[items.length - 1]!;
  parts.push(`${currentLabel} ${format(last)}`);
  if (items.length > 1) {
    const earlier = items.slice(0, -1).map(format).join(joiner);
    parts.push(`${earlierLabel} ${earlier}${suffix}`);
  }
}

/**
 * Build the user message for one tick: current block slot, occupants, errors, chat, owner messages.
 * Used by the Chat LLM each tick to decide which tools to call.
 */
export function buildUserMessage(state: ClawState, config: ClawConfig): string {
  const parts: string[] = [];

  // DM wake: model must call chat — Gemini often returns text only unless told emphatically
  if (state.dmReplyPending && state.lastDmPeerSessionId) {
    parts.push(
      `[DM REPLY REQUIRED] Someone DM'd you. You MUST respond by calling the chat tool with text="<your reply>" and targetSessionId="${state.lastDmPeerSessionId}". Do not reply with plain text only — the runtime only sends chat when you call the chat tool. If you output text without calling chat, your message will not be delivered.`
    );
  }

  // Soul-driven autonomous tick: owner away, LLM chooses actions from personality in system prompt
  if (state.autonomousSoulTickDue) {
    parts.push(
      "[AUTONOMOUS SOUL TICK] The owner is not present. Your behavior this turn must be driven only by the soul and skills in the system message—how you move, emote, or stay still should reflect that character. Use move (small steps or approachSessionId/approachPosition), emote, get_occupants if you need positions, or no tools to simply wait in character. Do not use chat for global broadcast. Do not start builds unless the soul clearly implies autonomous creative work without the owner present. One or zero tool calls preferred."
    );
  }

  parts.push(`Current block slot: ${state.blockSlotId}.`);

  if (config.ownerUserId && state.myPosition) {
    if (isOwnerNearby(state, config)) {
      parts.push(
        "Owner is nearby—obedient mode: only act on explicit Owner said or DM messages; do not wander or broadcast chat unless instructed."
      );
    } else if (config.autonomousSoulTickMs > 0) {
      parts.push(
        "Owner is not in range—autonomous mode: act according to your soul (above). Do not broadcast global chat; only DM replies when context shows a DM to you."
      );
    }
  }

  if (state.lastToolRun) {
    if (BUILD_TOOLS_NO_REPEAT.has(state.lastToolRun)) {
      parts.push(
        `Last tool you ran: ${state.lastToolRun}. Do not call build_full, build_with_code, or build_incremental again now; wait or do something else (e.g. move, get_occupants) or make no tool calls.`
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
    const fix = state.lastError.blockSlotId
      ? ` Suggested fix: join_block with blockSlotId "${state.lastError.blockSlotId}".`
      : "";
    parts.push(
      "[ENGINE ERROR — REPLY REQUIRED] The server/engine reported a problem. " +
        "Summarize in simple, friendly language what went wrong (not raw codes—explain like to a player). " +
        "Then call chat once with that summary so the user knows what happened. " +
        `Technical detail for you: code=${state.lastError.code} message=${state.lastError.message}.${fix}`
    );
  }

  // Chat: single-message focus — only the latest line is actionable; rest is context only.
  if (state.chat.length > 0) {
    const recent = state.chat.slice(-config.maxChatContext);
    pushCurrentAndEarlier(
      parts,
      recent,
      (c) => formatChatEntryLine(state, c),
      "CURRENT MESSAGE (act only in response to this; do not re-reply to older lines below):",
      "Earlier chat (context only—do not reply or re-process):",
      { earlierSuffix: HINT_HAVE_CHAT }
    );
    parts.push(
      state.lastTickSentChat ? hintAlreadyReplied(state.lastAgentChatMessage) : HINT_WHEN_TO_REPLY
    );
  }

  if (state.lastDmPeerSessionId) {
    parts.push(
      `Active DM peer session id (use as targetSessionId when replying in thread): ${state.lastDmPeerSessionId}.`
    );
  }

  if (state.ownerMessages.length > 0) {
    const owner = state.ownerMessages.slice(-config.maxOwnerMessages);
    pushCurrentAndEarlier(
      parts,
      owner,
      (o) => o.text,
      "CURRENT OWNER INSTRUCTION (act only on this):",
      "Earlier owner messages (context only):",
      { earlierJoiner: "; " }
    );
  }

  // Cached tool results — list_documents, list_catalog (get_occupants already in occupants section above)
  if (state.lastDocumentsList) {
    parts.push(`Cached document list (from list_documents): ${state.lastDocumentsList}.${HINT_HAVE_DOCUMENTS}`);
  }
  if (state.lastCatalogContext) {
    const catalogBlock =
      state.lastCatalogContext.length > MAX_INJECT_CATALOG_CHARS
        ? state.lastCatalogContext.slice(0, MAX_INJECT_CATALOG_CHARS) + "… (truncated)"
        : state.lastCatalogContext;
    parts.push("Cached catalog (compact, from list_catalog):" + HINT_HAVE_CATALOG + "\n" + catalogBlock);
  }
  if (state.lastOccupantsSummary && state.occupants.length === 0) {
    parts.push(
      `Last get_occupants result: ${state.lastOccupantsSummary}. No occupant details in context—call get_occupants again if you need positions.`
    );
  }

  if (parts.length === 1) {
    // Only "Current block slot" was added
    parts.push(HINT_NO_CONTEXT);
  }

  return parts.join("\n");
}
