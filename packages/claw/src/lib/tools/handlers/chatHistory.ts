import type { ToolContext } from "../types.js";

export async function handleGetChatHistory(ctx: ToolContext) {
  const { client, store, config, args, logAction } = ctx;
  const limit = typeof args.limit === "number" ? Math.min(100, args.limit) : config.maxChatContext;
  const channelId =
    typeof args.channelId === "string" && args.channelId.trim() ? args.channelId.trim() : undefined;
  const { messages } = await client.getChatHistory({
    limit,
    ...(channelId ? { channelId } : {}),
  });
  store.setState({
    chat: messages.map((m) => ({
      username: m.username,
      message: m.message,
      createdAt: m.createdAt,
      channelId: typeof m.channelId === "string" ? m.channelId : undefined,
    })),
  });
  const summary = `${messages.length} messages${channelId ? ` (channel ${channelId.slice(0, 24)}…)` : ""}`;
  logAction(summary);
  return { ok: true, summary };
}
