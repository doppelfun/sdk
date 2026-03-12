/**
 * DM channel check only — mirrors schema DM_USER_CHANNEL_PREFIX (keep in sync).
 * Claw avoids a dependency on @doppel-engine/schema. Replies use targetSessionId;
 * channelId is for get_chat_history.
 */
const DM_USER_PREFIX = "dm-user:"; // sync: schema chatChannels.DM_USER_CHANNEL_PREFIX

/** True if channelId is a DM thread (dm-user:… only). */
export function isDmChannel(channelId: string | undefined): boolean {
  return typeof channelId === "string" && channelId.startsWith(DM_USER_PREFIX);
}
