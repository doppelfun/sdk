/** Trim string and remove trailing slash. Use for normalizing hub/engine/base URLs. */
export function normalizeUrl(s: string): string {
  return s.trim().replace(/\/$/, "");
}
