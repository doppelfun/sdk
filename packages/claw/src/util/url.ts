/** Trim string and remove trailing slash. */
export function normalizeUrl(s: string): string {
  return s.trim().replace(/\/$/, "");
}
