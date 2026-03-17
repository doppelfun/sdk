/**
 * Simple string hash for idempotency keys (e.g. sessionId + message).
 * Not cryptographic; used only for deduplication.
 */
export function hashString(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = (h * 33) ^ str.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}
