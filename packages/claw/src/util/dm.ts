/**
 * DM channel check — session-based threads use dm: prefix (dmThreadId on server).
 * Claw avoids a dependency on @doppel-engine/schema. Replies use targetSessionId.
 */
const DM_PREFIX = "dm:";

/** True if channelId is a DM thread (dm:sessionA:sessionB). */
export function isDmChannel(channelId: string | undefined): boolean {
  return typeof channelId === "string" && channelId.startsWith(DM_PREFIX);
}
