/**
 * DM channel helpers — mirror @doppel-engine/schema chatChannels so Claw
 * can route replies without depending on the engine package.
 * Channel id format: dm:<sessionA>:<sessionB> (sorted).
 */

/** True if channelId is a DM thread. */
export function isDmChannel(channelId: string | undefined): boolean {
  return typeof channelId === "string" && channelId.startsWith("dm:");
}

/**
 * From dm:s1:s2 and local session id, return the other participant's session id.
 */
export function otherSessionIdFromDmChannel(channelId: string, localSessionId: string): string | null {
  if (!isDmChannel(channelId) || !localSessionId) return null;
  const parts = channelId.split(":");
  if (parts.length !== 3 || parts[0] !== "dm") return null;
  const a = parts[1];
  const b = parts[2];
  if (a === localSessionId) return b;
  if (b === localSessionId) return a;
  return null;
}
