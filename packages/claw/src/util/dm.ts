const DM_PREFIX = "dm:";

/** True if channelId is a DM thread (dm:sessionA:sessionB). */
export function isDmChannel(channelId: string | undefined): boolean {
  return typeof channelId === "string" && channelId.startsWith(DM_PREFIX);
}
