import type { ToolContext } from "../types.js";

export async function handleEmote(ctx: ToolContext) {
  const { client, args, logAction } = ctx;
  const emoteId = typeof args.emoteId === "string" ? args.emoteId.trim() : "";
  if (emoteId) client.sendEmote(emoteId);
  const summary = emoteId ? `emote ${emoteId}` : "emote (no id)";
  logAction(summary);
  return { ok: true, summary };
}
