/**
 * User-message sections for each tick.
 *
 * The per-tick user prompt is built by running every section in
 * USER_MESSAGE_SECTION_DESCRIPTORS in order. Each section has:
 * - **id**: For tests and logging.
 * - **when** (optional): If present and false, the section is skipped; otherwise render runs.
 * - **render**: Returns zero or more lines to append ([] means "nothing this tick").
 *
 * To add a section: implement a function (ctx) => string[], then add an entry to
 * USER_MESSAGE_SECTION_DESCRIPTORS. To reorder, move entries in that array.
 */

import type { ClawConfig } from "../config/index.js";
import type { ClawState } from "../state/state.js";
import type { ClawStoreApi } from "../state/store.js";
import { isOwnerNearby } from "../movement/index.js";
import {
  HINT_HAVE_CHAT,
  HINT_HAVE_DOCUMENTS,
  HINT_HAVE_OCCUPANTS,
  HINT_HAVE_CATALOG,
  HINT_WHEN_TO_REPLY,
  BUILD_TOOLS_NO_REPEAT,
  MAX_INJECT_CATALOG_CHARS,
  hintAlreadyReplied,
} from "./hints.js";
import { formatChatEntryLine, pushCurrentAndEarlier } from "./formatHelpers.js";
import { loadTemplate, replaceVars } from "./templateLoader.js";

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** Context passed to every section: current state, config, and store (for side effects like clearing build target). */
export type UserMessageContext = {
  state: ClawState;
  config: ClawConfig;
  store: ClawStoreApi;
};

/**
 * Descriptor for one section of the user message.
 * Use **when** when the section should be skipped often (cleaner than returning [] from render).
 */
export type UserMessageSectionDescriptor = {
  id: string;
  when?: (ctx: UserMessageContext) => boolean;
  render: (ctx: UserMessageContext) => string[];
};

// -----------------------------------------------------------------------------
// Constants (avoid magic numbers in section logic)
// -----------------------------------------------------------------------------

/** Distance (m) within which we consider the agent to have "reached" the build target. */
const BUILD_TARGET_STOP_DISTANCE_M = 2;

// -----------------------------------------------------------------------------
// Wake / urgency (template-driven; when-guard so render only runs when relevant)
// -----------------------------------------------------------------------------

/** Instructs the model to reply via the chat tool to a DM; uses templates/user-dm-reply-required.md. */
export function sectionDmReplyRequired(ctx: UserMessageContext): string[] {
  const tpl = loadTemplate("user-dm-reply-required");
  return [
    replaceVars(tpl, {
      lastDmPeerSessionId: ctx.state.lastDmPeerSessionId ?? "",
    }),
  ];
}

/** Instructs the model to act from soul/skills only (owner away); uses templates/user-autonomous-soul-tick.md. */
export function sectionAutonomousSoulTick(ctx: UserMessageContext): string[] {
  return [loadTemplate("user-autonomous-soul-tick")];
}

// -----------------------------------------------------------------------------
// Location and presence
// -----------------------------------------------------------------------------

/** Current block slot id (always one line). */
export function sectionBlockSlot(ctx: UserMessageContext): string[] {
  return [`Current block slot: ${ctx.state.blockSlotId}.`];
}

/** Owner proximity: obedient vs autonomous mode. Only when owner is configured and we have position. */
export function sectionOwnerProximity(ctx: UserMessageContext): string[] {
  const { state, config } = ctx;
  if (!config.ownerUserId || !state.myPosition) return [];
  if (isOwnerNearby(state, config)) {
    return [
      "Owner is nearby—obedient mode: only act on explicit Owner said or DM messages; do not wander or broadcast chat unless instructed.",
    ];
  }
  if (config.autonomousSoulTickMs > 0) {
    return [
      "Owner is not in range—autonomous mode: act according to your soul (above). Do not broadcast global chat; only DM replies when context shows a DM to you.",
    ];
  }
  return [];
}

/** Agent position when known. */
export function sectionPosition(ctx: UserMessageContext): string[] {
  const { state } = ctx;
  if (!state.myPosition) return [];
  const { x, y, z } = state.myPosition;
  return [`Your position: (${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}).`];
}

/** Occupants in block: those with position (for approach), then full list + hint not to re-call get_occupants. */
export function sectionOccupants(ctx: UserMessageContext): string[] {
  const { state } = ctx;
  if (state.occupants.length === 0) return [];
  const parts: string[] = [];
  const othersWithPosition = state.occupants.filter(
    (o) => o.position && o.clientId !== state.mySessionId
  );
  if (othersWithPosition.length > 0) {
    const list = othersWithPosition
      .map(
        (o) =>
          `${o.username} (${o.type}) at (${(o.position!.x).toFixed(1)}, ${(o.position!.z).toFixed(1)})`
      )
      .join("; ");
    parts.push(`Other occupants with position (move toward one to approach): ${list}.`);
  }
  const list = state.occupants.map((o) => `${o.username} (${o.type})`).join(", ");
  parts.push(`Occupants (${state.occupants.length}): ${list}.${HINT_HAVE_OCCUPANTS}`);
  return parts;
}

// -----------------------------------------------------------------------------
// Last tool and build target
// -----------------------------------------------------------------------------

/** Last tool run; special wording when it was a build tool (avoid repeating build tools back-to-back). */
export function sectionLastToolRun(ctx: UserMessageContext): string[] {
  const { state } = ctx;
  if (!state.lastToolRun) return [];
  if (BUILD_TOOLS_NO_REPEAT.has(state.lastToolRun)) {
    return [
      `Last tool you ran: ${state.lastToolRun}. Do not call build_full, build_with_code, or build_incremental again now; wait or do something else (e.g. move, get_occupants) or make no tool calls.`,
    ];
  }
  return [`Last tool you ran: ${state.lastToolRun}.`];
}

/**
 * Build target: either "reached" (and we clear it) or the target coords.
 * Clears store.lastBuildTarget when within BUILD_TARGET_STOP_DISTANCE_M.
 */
export function sectionBuildTarget(ctx: UserMessageContext): string[] {
  const { state, store } = ctx;
  if (!state.lastBuildTarget) return [];
  const reached =
    state.myPosition &&
    Math.hypot(
      state.lastBuildTarget.x - state.myPosition.x,
      state.lastBuildTarget.z - state.myPosition.z
    ) < BUILD_TARGET_STOP_DISTANCE_M;
  if (reached) {
    store.setState({ lastBuildTarget: null });
    return [`Build target reached (within ${BUILD_TARGET_STOP_DISTANCE_M} m); do not move further toward it.`];
  }
  return [
    `Build target (move here then stop when within ~${BUILD_TARGET_STOP_DISTANCE_M} m): (${state.lastBuildTarget.x}, ${state.lastBuildTarget.z}).`,
  ];
}

// -----------------------------------------------------------------------------
// Errors (template-driven; when-guard so we only render when lastError is set)
// -----------------------------------------------------------------------------

/** Engine error to explain in chat; uses templates/user-engine-error.md with code, message, fix. */
export function sectionEngineError(ctx: UserMessageContext): string[] {
  const { state } = ctx;
  const err = state.lastError!;
  const fix = err.blockSlotId
    ? ` Suggested fix: join_block with blockSlotId "${err.blockSlotId}".`
    : "";
  const tpl = loadTemplate("user-engine-error");
  return [
    replaceVars(tpl, {
      code: err.code,
      message: err.message,
      fix,
    }),
  ];
}

// -----------------------------------------------------------------------------
// Chat and owner messages
// -----------------------------------------------------------------------------

/**
 * Recent chat: current message (actionable) + earlier context. Appends hint so model
 * doesn’t re-reply to old lines or re-call get_chat_history unnecessarily.
 */
export function sectionChat(ctx: UserMessageContext): string[] {
  const { state, config } = ctx;
  if (state.chat.length === 0) return [];
  const parts: string[] = [];
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
    state.lastTickSentChat
      ? hintAlreadyReplied(state.lastAgentChatMessage)
      : HINT_WHEN_TO_REPLY
  );
  return parts;
}

/** Active DM peer session id for targetSessionId when replying in thread. */
export function sectionDmPeer(ctx: UserMessageContext): string[] {
  const { state } = ctx;
  if (!state.lastDmPeerSessionId) return [];
  return [
    `Active DM peer session id (use as targetSessionId when replying in thread): ${state.lastDmPeerSessionId}.`,
  ];
}

/** Owner instruction stack: current (actionable) + earlier context. */
export function sectionOwnerMessages(ctx: UserMessageContext): string[] {
  const { state, config } = ctx;
  if (state.ownerMessages.length === 0) return [];
  const parts: string[] = [];
  const owner = state.ownerMessages.slice(-config.maxOwnerMessages);
  pushCurrentAndEarlier(
    parts,
    owner,
    (o) => o.text,
    "CURRENT OWNER INSTRUCTION (act only on this):",
    "Earlier owner messages (context only):",
    { earlierJoiner: "; " }
  );
  return parts;
}

// -----------------------------------------------------------------------------
// Cached tool results (so model doesn’t re-call list_documents / list_catalog unnecessarily)
// -----------------------------------------------------------------------------

/** Cached list_documents result and hint. */
export function sectionCachedDocuments(ctx: UserMessageContext): string[] {
  const { state } = ctx;
  if (!state.lastDocumentsList) return [];
  return [
    `Cached document list (from list_documents): ${state.lastDocumentsList}.${HINT_HAVE_DOCUMENTS}`,
  ];
}

/** Cached list_catalog result (truncated to MAX_INJECT_CATALOG_CHARS) and hint. */
export function sectionCachedCatalog(ctx: UserMessageContext): string[] {
  const { state } = ctx;
  if (!state.lastCatalogContext) return [];
  const catalogBlock =
    state.lastCatalogContext.length > MAX_INJECT_CATALOG_CHARS
      ? state.lastCatalogContext.slice(0, MAX_INJECT_CATALOG_CHARS) + "… (truncated)"
      : state.lastCatalogContext;
  return [
    "Cached catalog (compact, from list_catalog):" +
      HINT_HAVE_CATALOG +
      "\n" +
      catalogBlock,
  ];
}

/** Last get_occupants summary when we don’t have full occupant list in context (e.g. after reconnect). */
export function sectionOccupantsSummary(ctx: UserMessageContext): string[] {
  const { state } = ctx;
  if (!state.lastOccupantsSummary || state.occupants.length > 0) return [];
  return [
    `Last get_occupants result: ${state.lastOccupantsSummary}. No occupant details in context—call get_occupants again if you need positions.`,
  ];
}

// -----------------------------------------------------------------------------
// Section registry (order = order in final user message)
// -----------------------------------------------------------------------------

export const USER_MESSAGE_SECTION_DESCRIPTORS: UserMessageSectionDescriptor[] = [
  { id: "dm_reply_required", when: (ctx) => !!(ctx.state.dmReplyPending && ctx.state.lastDmPeerSessionId), render: sectionDmReplyRequired },
  { id: "autonomous_soul_tick", when: (ctx) => !!ctx.state.autonomousSoulTickDue, render: sectionAutonomousSoulTick },
  { id: "block_slot", render: sectionBlockSlot },
  { id: "owner_proximity", render: sectionOwnerProximity },
  { id: "last_tool_run", render: sectionLastToolRun },
  { id: "position", render: sectionPosition },
  { id: "occupants", render: sectionOccupants },
  { id: "build_target", render: sectionBuildTarget },
  { id: "engine_error", when: (ctx) => !!ctx.state.lastError, render: sectionEngineError },
  { id: "chat", render: sectionChat },
  { id: "dm_peer", render: sectionDmPeer },
  { id: "owner_messages", render: sectionOwnerMessages },
  { id: "cached_documents", render: sectionCachedDocuments },
  { id: "cached_catalog", render: sectionCachedCatalog },
  { id: "occupants_summary", render: sectionOccupantsSummary },
];
