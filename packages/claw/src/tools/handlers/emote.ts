/**
 * Emote tool handler: play an emote by catalog id (e.g. wave, heart, spellcast).
 */
import type { ToolContext } from "../types.js";
import { clawLog } from "../../util/log.js";

/**
 * Handle emote tool: send emote to engine by catalog id. Server validates id.
 *
 * @param ctx - Tool context (args.emoteId)
 * @returns ExecuteToolResult
 */
export async function handleEmote(ctx: ToolContext) {
  const { client, args, logAction } = ctx;
  const emoteId = typeof args.emoteId === "string" ? args.emoteId.trim() : "";
  if (!emoteId) {
    return { ok: false, error: "emote requires emoteId (e.g. wave, heart, spellcast)." };
  }
  client.sendEmote?.(emoteId);
  clawLog("emote", emoteId);
  logAction(`emote ${emoteId}`);
  return { ok: true as const, summary: `emote ${emoteId}` };
}
