const DM_PREFIX = "dm:";

/** True if channelId is a DM thread (dm:sessionA:sessionB). */
export function isDmChannel(channelId: string | undefined): boolean {
  return typeof channelId === "string" && channelId.startsWith(DM_PREFIX);
}

/**
 * True if mySessionId is one of the two participants in this DM channel.
 * Used so only the intended recipient (and sender, who is skipped earlier) treats a broadcast DM as "for me".
 */
export function isParticipantInDmChannel(
  channelId: string | undefined,
  mySessionId: string | null | undefined
): boolean {
  if (!channelId || !mySessionId || !channelId.startsWith(DM_PREFIX)) return false;
  const parts = channelId.split(":");
  if (parts.length !== 3 || parts[0] !== "dm") return false;
  const a = parts[1];
  const b = parts[2];
  return a === mySessionId || b === mySessionId;
}
